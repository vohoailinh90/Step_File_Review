/**
 * Unit tests for turning the view (src/app/05-orbit.js) and for moving a part
 * along a picked axis in the exploded view (src/app/47-move.js), on the vendored
 * three.js itself.
 *
 *   node --test tests/move.test.mjs
 *
 * Every app module loads, in filename order, as one script -- as build.py ships
 * it (tests/harness.mjs). Turning is camera arithmetic and a move is a vector, so
 * both are pinned here, down to the picking ray; real mouse input, the drawn
 * handle and the rendered result are covered in headless Chromium by
 * tests/browser/t20_orbit_move.js.
 *
 * Geometry is in mesh units = metres, as OpenCASCADE writes glTF; the viewer
 * shows x1000, so a typed "25" is 0.025 here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runInContext } from 'node:vm';
import { loadViewer, ROOT } from './harness.mjs';

const MODULES = readdirSync(join(ROOT, 'src/app')).filter(f => f.endsWith('.js')).sort()
  .map(f => 'src/app/' + f);
const v = loadViewer(MODULES, ['orbitBy', 'orbitStep', 'axisFrom', 'axisName', 'moveTo', 'moveTyped',
  'moveStep', 'axisParam', 'moveDragBegin', 'moveDragTo', 'pick', 'setExplode', 'topology',
  'faceEntity', 'relate', 'minDistance', 'renderMeasure'], { three: 'real' });
const T = v.THREE;
const run = src => runInContext(src, v.ctx);
run('modelSize = 0.1');

const H = 600;                                   // the canvas stub's height: one full turn per 600 px
const near = (a, b, tol = 1e-9) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= tol);
const at = () => run('camera.position.toArray()'), up = () => run('camera.up.toArray()');

/** Look at `target` from `pos`, with `u` for up, and nothing left coasting. */
function view(pos, u = [0, 1, 0], target = [0, 0, 0]) {
  Object.assign(v.ctx, { __p: pos, __u: u, __t: target });
  run(`orbitStop(); controls.target.set(...__t); camera.position.set(...__p); camera.up.set(...__u);
       camera.lookAt(controls.target); camera.updateMatrixWorld();`);
}

// ---------------------------------------------------------------------------
// Turning the view. OrbitControls stopped the camera dead at its poles: a drag
// up or down froze once the view looked straight down, however far the mouse
// went. The turn now has no end stop in any direction, and otherwise turns as
// it did: sideways about the vertical, one full turn per canvas height.
// ---------------------------------------------------------------------------
test('OrbitControls no longer turns the view: its turn stops at the poles', () => {
  assert.equal(run('controls.enableRotate'), false, 'it would turn the view too, twice as fast and stopped at the poles');
});

test('a drag down turns the view straight on over the top, with no end stop', () => {
  view([0, 0, 5]);
  v.orbitBy(0, H / 4);
  assert.ok(near(at(), [0, 5, 0]), `a quarter turn looks straight down, got ${at()}`);
  assert.ok(near(up(), [0, 0, -1]), `with the back of the model at the top of the screen, got ${up()}`);
  v.orbitBy(0, H / 4);
  assert.ok(near(at(), [0, 0, -5]), `half a turn looks from behind, got ${at()}`);
  assert.ok(near(up(), [0, -1, 0]), `upside down, got ${up()}`);
  v.orbitBy(0, H / 2);
  assert.ok(near(at(), [0, 0, 5]) && near(up(), [0, 1, 0]), `a full turn comes back where it began, got ${at()} / ${up()}`);
});

test('a drag up turns the other way, under the bottom, just as far', () => {
  view([0, 0, 5]);
  v.orbitBy(0, -H / 4);
  assert.ok(near(at(), [0, -5, 0]) && near(up(), [0, 0, 1]), `looking straight up, got ${at()} / ${up()}`);
  v.orbitBy(0, -H / 4);
  assert.ok(near(at(), [0, 0, -5]) && near(up(), [0, -1, 0]), `from behind, upside down, got ${at()} / ${up()}`);
});

test('a sideways drag spins about the vertical, one full turn per canvas height, as often as dragged', () => {
  view([0, 0, 5]);
  v.orbitBy(H / 4, 0);
  assert.ok(near(at(), [-5, 0, 0]), `dragging right swings the camera left, turning the model right; got ${at()}`);
  v.orbitBy(3 * H / 4, 0);
  assert.ok(near(at(), [0, 0, 5]), `one full turn, got ${at()}`);
  v.orbitBy(5 * H / 2, 0);
  assert.ok(near(at(), [0, 0, -5]), `two and a half turns in one drag, got ${at()}`);
  assert.ok(near(up(), [0, 1, 0]), 'and the model stays upright');
});

test('upside down, a sideways drag still carries the near side of the model with the cursor', () => {
  view([0, 0, -5], [0, -1, 0]);                  // where half a turn over the top leaves it
  // screen right is +X from here, as it is from the front, so dragging right must swing
  // the camera to -X, as it does from the front
  v.orbitBy(H / 4, 0);
  assert.ok(near(at(), [-5, 0, 0]), `got ${at()}`);
  assert.ok(near(up(), [0, -1, 0]), 'and it stays upside down');
});

test('from any view a sideways drag keeps the model\'s vertical upright on screen', () => {
  view([3, 2, 4]);
  v.orbitBy(123, 0);
  const p = at();
  assert.ok(Math.abs(p[1] - 2) < 1e-9 && Math.abs(Math.hypot(p[0], p[2]) - 5) < 1e-9, `a turn about Y, got ${p}`);
  run('camera.updateMatrixWorld()');
  assert.ok(Math.abs(run('new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).y')) < 1e-9,
    'the screen\'s horizontal stays level: no roll creeps in');
});

test('the drag eases in with the damping, and lands on exactly the distance dragged', () => {
  view([0, 0, 5]);
  run(`orbitDX = ${H}; orbitDY = 0;`);           // one full turn, dragged
  v.orbitStep();
  const a = 2 * Math.PI * 0.12;                  // controls.dampingFactor of it in the first frame
  assert.ok(near(at(), [-5 * Math.sin(a), 0, 5 * Math.cos(a)], 1e-9), `the first frame turns 12 %, got ${at()}`);
  let n = 1;
  while (run('orbitDX !== 0 || orbitDY !== 0') && n < 1000){ v.orbitStep(); n++; }
  assert.ok(n < 1000, 'the turn comes to rest');
  assert.ok(near(at(), [0, 0, 5], 1e-9), `and ends one full turn on, got ${at()}`);
});

test('a standard view is upright again, and ends a coasting turn', () => {
  run('bboxCached = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));');
  try {
    view([0, 0, -5], [0, -1, 0]);
    run('orbitDX = 300; orbitDY = 40;');
    run('frame(VIEWS.front)');
    assert.ok(near(up(), [0, 1, 0], 0), `upright, got ${up()}`);
    assert.equal(run('orbitDX === 0 && orbitDY === 0'), true, 'no turn left to carry on after the view is set');
    const p = at();
    assert.ok(p[2] > 0 && Math.abs(p[0]) < 1e-12 && Math.abs(p[1]) < 1e-12, `looking from the front, got ${p}`);
  } finally { run('bboxCached = null;'); }
});

// ---------------------------------------------------------------------------
// Moving a part along a picked axis. A move is a vector per part (`moved`)
// that the exploded view adds to where it draws the part. Typed distances are
// exact; measurements stay on the assembled geometry.
// ---------------------------------------------------------------------------
/** A part as 10-load.js builds one, under `root`, assembled at `at`. */
function part(root, geometry, at, name) {
  const mesh = new T.Mesh(geometry, new T.MeshBasicMaterial());
  mesh.position.set(...at);
  root.add(mesh);
  root.updateMatrixWorld(true);
  geometry.computeBoundingBox();
  const p = { mesh, name, visible: true, edges: null, rowEl: { classList: { add() {}, remove() {} }, scrollIntoView() {} },
              restMatrix: mesh.matrixWorld.clone(), restCenter: new T.Vector3(), offset: new T.Vector3(),
              moved: new T.Vector3() };
  geometry.boundingBox.getCenter(p.restCenter).applyMatrix4(p.restMatrix);
  return p;
}
/** An open tube along Y (a shaft's skin), a plate square to Y, and a second plate above it. */
function withAssembly(fn) {
  const root = new T.Group();
  const shaft = part(root, new T.CylinderGeometry(0.01, 0.01, 0.03, 64, 1, true), [-0.03, 0.035, 0], 'shaft');
  const plate = part(root, new T.BoxGeometry(0.1, 0.01, 0.06), [0.02, 0, 0], 'plate');
  const cover = part(root, new T.BoxGeometry(0.1, 0.01, 0.06), [0.02, 0.02, 0], 'cover');
  Object.assign(v.ctx, { __root: root, __parts: [shaft, plate, cover] });
  run(`modelRoot = __root; parts = __parts; modelCenter = new THREE.Vector3(0, 0, 0);
       explodeAxis = 'all'; explodeAmt = 0; moveAxis = null; selected = null; measA = measB = null;`);
  try { fn({ shaft, plate, cover }); }
  finally {
    run(`parts.forEach(p => p.moved.set(0, 0, 0)); explodeAxis = 'all'; setExplode(0); axisPickMode = false;
         moveAxis = null; selected = null; measA = measB = null; modelRoot = null; parts = [];`);
  }
}
const faceOf = (p, pred) => {
  const topo = v.topology(p.mesh.geometry), n = Math.max(...topo.faceId) + 1;
  return Array.from({ length: n }, (_, f) => v.faceEntity(p, f, null)).find(pred);
};
const cylinder = p => faceOf(p, e => e.geom.type === 'cylinder');
const planeFacing = (p, sign) => faceOf(p, e => e.geom.type === 'plane' && Math.abs(e.geom.n.y - sign) < 1e-9);
const pos = p => p.mesh.getWorldPosition(new T.Vector3()).toArray();
const box = () => run("$('moveDist').value");
function useAxis(ent, p) { v.ctx.__a = v.axisFrom(ent); v.ctx.__s = p; run('moveAxis = __a; selected = __s;'); return v.ctx.__a; }

test('a cylinder gives its axis, + pointing out of the assembly through the part', () => {
  withAssembly(({ shaft }) => {
    const a = v.axisFrom(cylinder(shaft));
    assert.ok(near(a.d.toArray(), [0, 1, 0], 1e-6), `the shaft sits above the centre: + is up, got ${a.d.toArray()}`);
    assert.ok(Math.abs(a.p.x + 0.03) < 1e-6 && Math.abs(a.p.z) < 1e-6, `a point on the axis, got ${a.p.toArray()}`);
    assert.equal(v.axisName(a), 'cylinder Ø20.00 mm (mesh)', 'fitted to the mesh here, and it says so');
    run('modelCenter = new THREE.Vector3(0, 0.1, 0);');   // now the shaft sits below it
    assert.ok(near(v.axisFrom(cylinder(shaft)).d.toArray(), [0, -1, 0], 1e-6), '+ is down');
  });
});

test('a cylinder from the STEP B-rep is named without (mesh)', () => {
  withAssembly(() => {
    const g = new T.CylinderGeometry(0.01, 0.01, 0.03, 64, 1, true);
    g.userData.brep = { tri: new Array(g.index.count / 3).fill(0),
      faces: [{ type: 'cylinder', origin: [0, 0, 0], axis: [0, 1, 0], radius: 0.01 }] };
    const e = cylinder(part(run('modelRoot'), g, [0.04, 0.03, 0], 'pin'));
    assert.equal(e.exact, true);
    assert.equal(v.axisName(v.axisFrom(e)), 'cylinder Ø20.00 mm');
  });
});

test('a straight edge gives its direction, a flat face its normal', () => {
  withAssembly(({ plate, cover }) => {
    const line = { kind: 'edge', part: cover, hit: new T.Vector3(), exact: true, geom: { type: 'line',
      p0: new T.Vector3(-0.03, 0.025, 0.03), p1: new T.Vector3(0.07, 0.025, 0.03), d: new T.Vector3(1, 0, 0), len: 0.1 } };
    const a = v.axisFrom(line);
    assert.ok(near(a.d.toArray(), [1, 0, 0]) && near(a.p.toArray(), [0.02, 0.025, 0.03], 1e-12), 'along the edge, from its middle');
    assert.equal(v.axisName(a), 'edge 100.00 mm', 'an edge its two B-rep faces pin down');
    assert.equal(v.axisName(v.axisFrom({ ...line, exact: false })), 'edge 100.00 mm (mesh)', 'one read off the mesh says so');
    const n = v.axisFrom(planeFacing(plate, -1));    // the plate's underside: + still points out, down and away
    assert.ok(near(n.d.toArray(), [0, 1, 0], 1e-9) || near(n.d.toArray(), [0, -1, 0], 1e-9), 'square to the face');
    assert.ok(n.d.dot(plate.restCenter.clone().sub(run('modelCenter'))) >= 0, 'pointing out of the assembly');
    assert.equal(v.axisName(n), 'face normal (mesh)', 'the box has no B-rep data: its plane is fitted, and says so');
    assert.equal(v.axisName({ ...n, exact: true }), 'face normal', 'a plane from the STEP B-rep');
    const cone = { kind: 'face', part: cover, hit: new T.Vector3(0.02, 0.03, 0), geom: { type: 'cone',
      apex: new T.Vector3(0.02, 0.05, 0), a: new T.Vector3(0, 1, 0), semi: 0.5 } };
    assert.equal(v.axisName(v.axisFrom(cone)), 'cone (mesh)', 'a cone read off the mesh says so too');
    assert.equal(v.axisName(v.axisFrom({ ...cone, exact: true })), 'cone');
    const none = v.axisFrom({ part: plate, hit: new T.Vector3(), geom: { type: 'sphere', c: new T.Vector3(), r: 0.01 } });
    assert.equal(none, null, 'a sphere has no one axis to move along');
  });
});

test('a typed distance puts the part exactly that far along the axis, in millimetres', () => {
  withAssembly(({ shaft }) => {
    useAxis(cylinder(shaft), shaft);
    const rest = pos(shaft);
    v.moveTyped('25');
    assert.ok(near(pos(shaft), [rest[0], rest[1] + 0.025, rest[2]], 1e-12), `25 mm up, got ${pos(shaft)}`);
    assert.equal(box(), '25');
    v.moveTyped('25');
    assert.ok(Math.abs(shaft.moved.y - 0.025) < 1e-15, 'typing it again leaves it there: the distance is from assembled');
    v.moveTyped('-12.5');
    assert.ok(near(shaft.moved.toArray(), [0, -0.0125, 0], 1e-15), 'a negative distance goes the other way');
    v.moveTyped('7,5');
    assert.ok(near(shaft.moved.toArray(), [0, 0.0075, 0], 1e-15), 'a decimal comma reads as a point');
    v.moveTyped('');
    assert.ok(near(shaft.moved.toArray(), [0, 0.0075, 0], 1e-15), 'an empty box moves nothing');
    assert.equal(box(), '7.5', 'and shows the distance again');
  });
});

test('exploded, the box still reads and sets how far the part sits along the axis from assembled', () => {
  withAssembly(({ shaft }) => {
    useAxis(cylinder(shaft), shaft);
    v.setExplode(0.5);                           // radial, at 50 %: the shaft sits 35 mm up already
    run('moveSync();');
    assert.equal(box(), '35', 'an exploded part that was never moved reads where it is, not 0');
    v.moveTyped('60');
    assert.ok(Math.abs(shaft.offset.y - 0.06) < 1e-15, `60 mm up from assembled, got ${shaft.offset.y}`);
    assert.ok(Math.abs(shaft.moved.y - 0.025) < 1e-15, 'of which 25 mm is its own move');
    assert.equal(box(), '60');
    v.setExplode(0);
    assert.equal(box(), '25', 'with the explode off, its own move is all that is left');
  });
});

test('the box keeps what was typed, and refuses a distance past all sense', () => {
  withAssembly(({ shaft }) => {
    useAxis(cylinder(shaft), shaft);
    v.moveTyped('12.3456');
    assert.equal(box(), '12.3456', 'not rounded to 12.346');
    v.moveTyped('1e300');
    assert.ok(Math.abs(shaft.moved.y - 0.0123456) < 1e-15, `far beyond the model: nothing moves, got ${shaft.moved.y}`);
    assert.ok(pos(shaft).every(Number.isFinite), 'and the part is still drawn');
    assert.equal(box(), '12.3456');
  });
});

test('a move along one axis keeps a move along another', () => {
  withAssembly(({ shaft, plate }) => {
    useAxis(cylinder(shaft), shaft);
    v.moveTo(shaft, 0.02);
    useAxis({ kind: 'edge', part: plate, hit: new T.Vector3(), geom: { type: 'line', p0: new T.Vector3(),
      p1: new T.Vector3(0.1, 0, 0), d: new T.Vector3(1, 0, 0), len: 0.1 } }, shaft);
    v.moveTo(shaft, 0.01);
    assert.ok(near(shaft.moved.toArray(), [0.01, 0.02, 0], 1e-15), `got ${shaft.moved.toArray()}`);
    assert.equal(box(), '10', 'the box shows the distance along the axis in use');
  });
});

test('a move rides on the explode, and Along Axis explodes along the picked axis only', () => {
  withAssembly(({ shaft, plate, cover }) => {
    useAxis(cylinder(shaft), shaft);
    v.moveTo(shaft, 0.02);
    v.setExplode(0.5);                           // radial, at 50 %: 1x the distance from the centre
    assert.ok(near(shaft.offset.toArray(), [-0.03, 0.035 + 0.02, 0], 1e-12), `explode plus move, got ${shaft.offset.toArray()}`);
    run("explodeAxis = 'axis';");
    v.setExplode(1);                             // 2x, but only the part along the axis
    assert.ok(near(plate.offset.toArray(), [0, 0, 0], 1e-12), `the plate is level with the centre, got ${plate.offset.toArray()}`);
    assert.ok(near(cover.offset.toArray(), [0, 0.04, 0], 1e-12), `the cover moves up only, got ${cover.offset.toArray()}`);
    assert.ok(near(shaft.offset.toArray(), [0, 0.07 + 0.02, 0], 1e-12), `got ${shaft.offset.toArray()}`);
  });
});

test('a moved part is measured where it sits assembled, and the panel says so', () => {
  withAssembly(({ plate, cover }) => {
    const measure = () => {
      const a = planeFacing(plate, 1), b = planeFacing(cover, -1);
      return Object.fromEntries(v.relate(a, b, v.minDistance(a, b)).rows).distance;
    };
    assert.equal(measure(), '10.00 mm');
    useAxis(planeFacing(cover, 1), cover);
    v.moveTo(cover, 0.03);
    assert.equal(run('explodeAmt'), 0);
    assert.equal(measure(), '10.00 mm', 'measured on the assembled geometry, not where it is drawn');
    Object.assign(v.ctx, { __a: planeFacing(plate, 1), __b: planeFacing(cover, -1) });
    run("__a.color = __b.color = '#fff'; measA = __a; measB = __b; measMd = minDistance(__a, __b);");
    v.renderMeasure();
    const texts = run("$('measbody').children.map(c => c.textContent || '')");
    assert.ok(texts.includes('Exploded view: distances are for the assembled positions.'),
      'a part moved by hand is drawn apart as much as an exploded one');
  });
});

test('Fit frames the parts where they are drawn after a move', () => {
  withAssembly(({ shaft }) => {
    run('bboxCached = computeBBox();');
    run('frame()');
    const before = run('camera.position.distanceTo(controls.target)');
    useAxis(cylinder(shaft), shaft);
    v.moveTo(shaft, 0.5);
    run('frame()');
    assert.ok(run('camera.position.distanceTo(controls.target)') > 3 * before, 'the view takes in the part half a metre out');
    run('bboxCached = null;');
  });
});

// ---------------------------------------------------------------------------
// Picking the axis and dragging the part, down to the picking ray. The stub
// canvas is 800 x 600 at (0, 0); the camera is real.
// ---------------------------------------------------------------------------
/** The event for the pixel showing world point q. */
function pixel(q) {
  const s = new T.Vector3(...q).project(run('camera'));
  return { clientX: (s.x + 1) / 2 * 800, clientY: (1 - s.y) / 2 * 600, pointerId: 1 };
}

test('Pick axis, then a click on a cylinder, takes its axis and the part it belongs to', () => {
  withAssembly(({ shaft }) => {
    view([-0.03, 0.035, 0.2], [0, 1, 0], [-0.03, 0.035, 0]);
    run('axisPickMode = true;');                 // Pick... pressed: the next click in the view picks the axis
    v.pick(pixel([0.3, 0.3, 0]));
    assert.equal(run('moveAxis'), null, 'a click on nothing picks nothing');
    assert.equal(run('axisPickMode'), true, 'and the next click is still for the axis');
    v.pick(pixel([-0.03, 0.035, 0.01]));
    assert.ok(run('moveAxis') && near(run('moveAxis.d.toArray()'), [0, 1, 0], 1e-6), 'the shaft\'s axis');
    assert.equal(run('selected'), shaft, 'and the shaft is the part to move');
    assert.equal(run('axisPickMode'), false, 'after which a click selects again');
  });
});

test('the point under the cursor is found along the axis, from any view', () => {
  view([0.3, 0.2, 1]);
  run("moveAxis = {p: new THREE.Vector3(), d: new THREE.Vector3(1, 0, 0), part: null, geom: {type: 'line'}};");
  const c = new T.Vector3();
  for (const x of [0.1, -0.05, 0.2]) {
    const t = v.axisParam(pixel([x, 0, 0]), c);
    assert.ok(Math.abs(t - x) < 1e-7, `the cursor on the axis at x = ${x} reads ${t}`);
  }
  assert.ok(Math.abs(v.axisParam(pixel([0.1, 0, 0]), new T.Vector3(0.02, 0, 0)) - 0.08) < 1e-7, 'measured from c');
  view([0, 0, 1]);
  run("moveAxis.d.set(0, 0, 1);");
  assert.equal(v.axisParam(pixel([0, 0, 0]), c), null, 'an axis pointing at the eye has nothing to slide along');
  const a = 2 * Math.PI / 180;                   // 2 deg off the line of sight: a pixel is metres along it
  run(`moveAxis.d.set(${Math.sin(a)}, 0, ${Math.cos(a)});`);
  assert.equal(v.axisParam(pixel([0, 0, 0]), c), null, 'nor one a few degrees off it: a drag there would fling the part');
  run('moveAxis = null;');
});

test('a dragged part follows the cursor along the axis, in round steps', () => {
  withAssembly(({ plate }) => {
    view([0.05, 0.08, 0.15], [0, 1, 0], [0.02, 0, 0]);
    useAxis({ kind: 'edge', part: plate, hit: new T.Vector3(), geom: { type: 'line', p0: new T.Vector3(-0.03, 0, 0),
      p1: new T.Vector3(0.07, 0, 0), d: new T.Vector3(1, 0, 0), len: 0.1 } }, plate);
    const c = plate.restCenter.toArray(), step = v.moveStep(plate);
    assert.equal(v.moveDragBegin(pixel(c), plate), true);
    v.moveDragTo(pixel([c[0] + 0.02, c[1], c[2]]));
    assert.ok(Math.abs(plate.moved.x - 0.02) < 1e-12, `20 mm along, got ${plate.moved.x}`);
    // the axis is held where the drag began: the part keeps up with the cursor, not part of the way
    v.moveDragTo(pixel([c[0] + 0.03, c[1], c[2]]));
    assert.ok(Math.abs(plate.moved.x - 0.03) < 1e-12, `30 mm along, got ${plate.moved.x}`);
    v.moveDragTo(pixel([c[0] + 0.0302, c[1], c[2]]));
    assert.ok(Math.abs(plate.moved.x - 0.03) < 1e-12 && step > 0.0002, `a step of ${step * 1000} mm rounds 30.2 to 30, got ${plate.moved.x}`);
    run('moveDrag = null;');
  });
});

test('the drag step is the roundest length about 3 px long at the part', () => {
  withAssembly(({ plate }) => {
    const c = plate.restCenter;
    for (const [dist, mm] of [[0.1, 0.5], [1, 5], [0.01, 0.05]]) {
      view([c.x, c.y, c.z + dist], [0, 1, 0], c.toArray());
      const got = v.moveStep(plate) * 1000;
      assert.ok(Math.abs(got - mm) < 1e-9, `${dist} m away: 3 px is ${(3 * 2 * dist * Math.tan(Math.PI / 8) / 600 * 1000).toFixed(3)} mm, so ${mm} mm; got ${got}`);
    }
  });
});
