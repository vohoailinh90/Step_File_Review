/**
 * Shared test harness: load QuickSTEP's viewer modules outside a browser.
 *
 * The modules in src/app/ are script fragments sharing one closure, so they are
 * evaluated in a single node:vm context against stubs for THREE and the DOM.
 * Load them in filename order, exactly as build.py concatenates them, and the
 * closure behaves as it does in the browser.
 *
 * The stubs are deliberately thin. They exist so arithmetic and graph logic can
 * be tested -- unit scaling, triangle adjacency, face normals, circle fitting.
 * Nothing here renders, so nothing here can verify a pixel; that needs headless
 * Chromium and belongs to the test-engineer role (see .claude/agents/).
 *
 * Vector3 mirrors three.js semantics that the code depends on: add/sub/cross/
 * normalize/copy/multiplyScalar mutate in place AND return `this`, while clone()
 * returns a new instance. An unfaithful stub here would quietly void every test
 * that uses it, so treat this class as load-bearing.
 */
import { readFileSync } from 'node:fs';
import { createContext, runInContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export class Vector3 {
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  set(x, y, z) { this.x = x; this.y = y; this.z = z; return this; }
  clone() { return new Vector3(this.x, this.y, this.z); }
  copy(v) { this.x = v.x; this.y = v.y; this.z = v.z; return this; }
  add(v) { this.x += v.x; this.y += v.y; this.z += v.z; return this; }
  sub(v) { this.x -= v.x; this.y -= v.y; this.z -= v.z; return this; }
  multiplyScalar(s) { this.x *= s; this.y *= s; this.z *= s; return this; }
  divideScalar(s) { return this.multiplyScalar(1 / s); }
  dot(v) { return this.x * v.x + this.y * v.y + this.z * v.z; }
  cross(v) {
    const { x, y, z } = this;
    this.x = y * v.z - z * v.y;
    this.y = z * v.x - x * v.z;
    this.z = x * v.y - y * v.x;
    return this;
  }
  length() { return Math.hypot(this.x, this.y, this.z); }
  normalize() { const l = this.length() || 1; return this.multiplyScalar(1 / l); }
  distanceTo(v) { return Math.hypot(this.x - v.x, this.y - v.y, this.z - v.z); }
  applyMatrix4() { return this; }                 // identity matrixWorld in tests
  fromBufferAttribute(attr, i) {
    return this.set(attr.getX(i), attr.getY(i), attr.getZ(i));
  }
  addScaledVector(v, s) { this.x += v.x * s; this.y += v.y * s; this.z += v.z * s; return this; }
  negate() { return this.multiplyScalar(-1); }
}

/** Minimal BufferAttribute over a flat Float array, 3 components per vertex. */
export class BufferAttribute {
  constructor(array, itemSize = 3) { this.array = array; this.itemSize = itemSize; }
  get count() { return this.array.length / this.itemSize; }
  getX(i) { return this.array[i * this.itemSize]; }
  getY(i) { return this.array[i * this.itemSize + 1]; }
  getZ(i) { return this.array[i * this.itemSize + 2]; }
}

/** A geometry good enough for triAdjacency()/triNormal(): positions + userData. */
export function geometryFromTriangles(vertices, index = null) {
  return {
    attributes: { position: new BufferAttribute(Float32Array.from(vertices), 3) },
    index: index ? new BufferAttribute(Uint32Array.from(index), 1) : null,
    userData: {},
    setAttribute() {}, computeBoundingBox() {}, computeVertexNormals() {},
    dispose() {}, boundingBox: null,
  };
}

function stubElement() {
  const el = {
    style: {}, textContent: '', value: '', checked: false, dataset: {},
    children: [], classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {}, appendChild() {}, remove() {},
    // Records children, so a test can read what was built with textContent.
    append(...nodes) { this.children.push(...nodes); },
    replaceChildren(...nodes) { this.children = [...nodes]; },
    querySelector: () => stubElement(), querySelectorAll: () => [],
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }),
    scrollIntoView() {}, focus() {}, click() {}, insertAdjacentHTML() {},
    getContext: () => ({}), toDataURL: () => 'data:,', setAttribute() {},
    clientWidth: 800, clientHeight: 600, width: 800, height: 600,
  };
  return el;
}

class Box3 {
  constructor() { this.min = new Vector3(Infinity, Infinity, Infinity);
                  this.max = new Vector3(-Infinity, -Infinity, -Infinity); }
  /** Expand over every vertex of every mesh in a fake scene graph. */
  setFromObject(root) {
    const walk = o => {
      const pos = o?.geometry?.attributes?.position;
      if (pos) for (let i = 0; i < pos.count; i++) {
        this.min.x = Math.min(this.min.x, pos.getX(i)); this.max.x = Math.max(this.max.x, pos.getX(i));
        this.min.y = Math.min(this.min.y, pos.getY(i)); this.max.y = Math.max(this.max.y, pos.getY(i));
        this.min.z = Math.min(this.min.z, pos.getZ(i)); this.max.z = Math.max(this.max.z, pos.getZ(i));
      }
      (o?.children || []).forEach(walk);
    };
    walk(root);
    return this;
  }
  isEmpty() { return this.max.x < this.min.x; }
  getCenter(t) { return t.set((this.min.x + this.max.x) / 2, (this.min.y + this.max.y) / 2,
                              (this.min.z + this.max.z) / 2); }
  getSize(t) { return t.set(this.max.x - this.min.x, this.max.y - this.min.y,
                            this.max.z - this.min.z); }
  expandByObject() { return this; }
}

const noop = function () {};
function Ctor(props = {}) {
  return function (...args) { Object.assign(this, JSON.parse(JSON.stringify(props))); this._args = args; };
}

export function makeTHREE() {
  const obj3d = () => ({
    position: new Vector3(), rotation: new Vector3(), scale: new Vector3(1, 1, 1),
    children: [], userData: {}, matrixWorld: {}, visible: true,
    add(c) { this.children.push(c); return this; }, remove() { return this; },
    traverse(fn) { fn(this); (this.children || []).forEach(c => c.traverse && c.traverse(fn)); },
    updateMatrixWorld: noop, lookAt: noop, applyMatrix4: noop, clone() { return this; },
  });

  class Scene { constructor() { Object.assign(this, obj3d()); this.background = null; } }
  class Mesh {
    constructor(geometry, material) {
      Object.assign(this, obj3d());
      this.geometry = geometry; this.material = material; this.renderOrder = 0;
    }
  }
  class PerspectiveCamera {
    constructor(fov = 45, aspect = 1, near = 0.1, far = 1000) {
      Object.assign(this, obj3d());
      Object.assign(this, { fov, aspect, near, far, up: new Vector3(0, 1, 0) });
    }
    updateProjectionMatrix() {}
  }
  class WebGLRenderer {
    constructor(opts = {}) {
      Object.assign(this, opts);
      this.domElement = stubElement();
      this.outputEncoding = null; this.localClippingEnabled = false;
      this.info = { render: { calls: 0 } };
    }
    setPixelRatio() {} setSize() {} render() {} setAnimationLoop() {}
    getSize(t) { return t.set ? t.set(800, 600) : t; } clear() {} dispose() {}
    getContext() { return {}; }
  }
  class Material { constructor(o = {}) { Object.assign(this, o); this.emissive = { setHex() {} }; }
                   dispose() {} }
  class Light { constructor() { Object.assign(this, obj3d()); } }

  return {
    Vector3, Vector2: Vector3, Box3, Scene, Mesh, PerspectiveCamera, WebGLRenderer,
    BufferAttribute, Float32BufferAttribute: BufferAttribute,
    BufferGeometry: class { constructor() { Object.assign(this, geometryFromTriangles([])); }
                            setAttribute() {} dispose() {} setFromPoints() { return this; } },
    MeshStandardMaterial: Material, MeshBasicMaterial: Material, LineBasicMaterial: Material,
    HemisphereLight: Light, DirectionalLight: Light, AmbientLight: Light,
    Color: class { constructor(h) { this.hex = h; } setHex(h) { this.hex = h; return this; }
                   getHex() { return this.hex; } },
    Plane: class { constructor(n, c) { this.normal = n || new Vector3(); this.constant = c || 0; }
                   distanceToPoint() { return 1; } setFromNormalAndCoplanarPoint(n, p) {
                     this.normal = n.clone(); this.constant = -n.dot(p); return this; } },
    Raycaster: class { constructor() { this.params = { Line: {} }; this.ray = { origin: new Vector3(), direction: new Vector3() }; }
                       setFromCamera() {} intersectObjects() { return []; } intersectObject() { return []; } },
    Group: class { constructor() { Object.assign(this, obj3d()); } },
    Line: class { constructor(g, m) { Object.assign(this, obj3d()); this.geometry = g; this.material = m; } },
    LineSegments: class { constructor(g, m) { Object.assign(this, obj3d()); this.geometry = g; this.material = m; } },
    EdgesGeometry: class { constructor() { Object.assign(this, geometryFromTriangles([])); } },
    Matrix4: class { constructor() {} identity() { return this; } copy() { return this; }
                     invert() { return this; } },
    MathUtils: { degToRad: d => d * Math.PI / 180, radToDeg: r => r * 180 / Math.PI,
                 clamp: (v, a, b) => Math.max(a, Math.min(b, v)) },
    OrbitControls: class { constructor() { this.target = new Vector3(); this.enableDamping = false; }
                           update() {} addEventListener() {} saveState() {} reset() {} },
    GLTFLoader: class { parse(_b, _p, onLoad) { onLoad({ scene: new Scene() }); } setPath() {} },
    // Records the hook src/app/10-load.js installs, so a test can call it.
    DefaultLoadingManager: { urlModifier: null, setURLModifier(fn) { this.urlModifier = fn; return this; } },
    STLLoader: class { parse() { return geometryFromTriangles([]); } },
    DoubleSide: 2, FrontSide: 0, BackSide: 1, sRGBEncoding: 3001,
    AlwaysStencilFunc: 519, ReplaceStencilOp: 7681, KeepStencilOp: 7680,
    IncrementWrapStencilOp: 34055, DecrementWrapStencilOp: 34056, NotEqualStencilFunc: 517,
    REVISION: '137-stub',
  };
}

/**
 * Evaluate the named modules in one shared context, in the order given, then
 * return the requested globals. Pass modules in filename order to match build.py.
 */
// The page the viewer is served from: stepview.py's loopback server.
export const PAGE = 'http://127.0.0.1:8000/?model=/model.glb';

export function loadViewer(modules, names = []) {
  const THREE = makeTHREE();
  const page = new URL(PAGE);
  const location = { href: page.href, origin: page.origin, search: page.search };
  const el = stubElement();
  const ctx = createContext({
    THREE, Math, console, JSON, Set, Map, Array, Object, Number, String, Boolean,
    Float32Array, Uint32Array, Uint16Array, isNaN, parseFloat, parseInt, Date, Error,
    performance: { now: () => 0 },
    document: {
      getElementById: () => el, querySelector: () => el, querySelectorAll: () => [],
      createElement: () => stubElement(), body: el, addEventListener() {},
      createElementNS: () => stubElement(),
    },
    location,
    window: { devicePixelRatio: 1, addEventListener() {}, location,
              matchMedia: () => ({ matches: false, addEventListener() {} }) },
    ResizeObserver: class { observe() {} unobserve() {} disconnect() {} },
    URLSearchParams: class { get() { return null; } },
    fetch: () => Promise.reject(new Error('network disabled in tests')),
    requestAnimationFrame: () => 0,
    setTimeout: () => 0, clearTimeout: () => {}, setInterval: () => 0, clearInterval: () => {},
    FileReader: class { readAsArrayBuffer() {} },
    // The real WHATWG parser: sameOrigin() is only as good as the URL it parses.
    Blob: class {}, URL: class extends URL {
      static createObjectURL() { return 'blob:'; } static revokeObjectURL() {} },
    alert() {}, navigator: { userAgent: 'node' },
  });
  ctx.globalThis = ctx;
  ctx.window.THREE = THREE;

  for (const rel of modules) {
    runInContext(readFileSync(join(ROOT, rel), 'utf8'), ctx, { filename: rel });
  }
  const out = { ctx, THREE };
  for (const n of names) out[n] = runInContext(n, ctx);
  return out;
}
