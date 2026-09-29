/**
 * Unit tests for Measure mode and the exploded view (src/app/31-fit.js to
 * 46-explode.js), on the vendored three.js itself.
 *
 *   node --test tests/measure.test.mjs
 *
 * Every app module loads, in filename order, as one script -- as build.py ships
 * it -- against the real three.js r147 in vendor/, so Vector3, Matrix4, Box3
 * and BufferGeometry are the ones the viewer runs on. Only the renderer, the
 * orbit controls and the loaders are stubs (tests/harness.mjs).
 *
 * Geometry is in mesh units = metres, as OpenCASCADE writes glTF; the viewer
 * reports x1000, so a 0.01 plate reads "10.00 mm". Each test pins a number the
 * measure panel shows an engineer, and tests/mutation_check.py breaks each one.
 * Nothing here renders: the drawn dimensions and picking by mouse are covered
 * by the headless-Chromium tests in tests/browser/ (PR #3).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runInContext } from 'node:vm';
import { loadViewer, ROOT } from './harness.mjs';

const MODULES = readdirSync(join(ROOT, 'src/app')).filter(f => f.endsWith('.js')).sort()
  .map(f => 'src/app/' + f);
const v = loadViewer(MODULES, ['topology', 'faceInfo', 'faceEntity', 'describe', 'relate',
  'minDistance', 'setExplode', 'renderMeasure', 'selectFace'], { three: 'real' });
const T = v.THREE;
const run = src => runInContext(src, v.ctx);
run('modelSize = 0.1');                          // eps in relate() scales with the model

/** A part as 10-load.js builds one: assembled at `at`, with nothing exploded. */
function part(geometry, at = [0, 0, 0], name = 'part') {
  const mesh = new T.Mesh(geometry, new T.MeshBasicMaterial());
  mesh.position.set(...at);
  mesh.updateMatrixWorld(true);
  geometry.computeBoundingBox();
  const p = { mesh, name, restMatrix: mesh.matrixWorld.clone(), restCenter: new T.Vector3(),
              offset: new T.Vector3(), moved: new T.Vector3() };
  geometry.boundingBox.getCenter(p.restCenter).applyMatrix4(p.restMatrix);
  return p;
}
/** Every face of a part, as entities, with the picked point at the face's first vertex. */
const faces = p => {
  const topo = v.topology(p.mesh.geometry), n = Math.max(...topo.faceId) + 1;
  return Array.from({ length: n }, (_, f) => v.faceEntity(p, f, null));
};
const planeFacing = (p, axis, sign) => faces(p).find(e =>
  e.geom.type === 'plane' && Math.abs(e.geom.n[axis] - sign) < 1e-9);
const rowsOf = r => Object.fromEntries(r.rows);

/** Two triangles sharing the edge (0,0,0)-(1,0,0), the second folded by deg about X. */
function hinge(deg) {
  const t = deg * Math.PI / 180, g = new T.BufferGeometry();
  g.setAttribute('position', new T.Float32BufferAttribute([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    0, 0, 0, 1, 0, 0, 0, Math.cos(t), Math.sin(t)], 3));
  return g;                                      // unindexed, like an STL
}
const faceCount = g => Math.max(...v.topology(g).faceId) + 1;

// ---------------------------------------------------------------------------
// What a face is. With no B-rep data (an STL), a face grows across triangles
// up to a 20 deg break -- README's documented limit -- so a chamfer stays its
// own face and its area is not merged into the wall beside it.
// ---------------------------------------------------------------------------
test('an unindexed mesh grows a face across a break softer than 20 degrees', () => {
  for (const deg of [0, 5, 10, 15, 19]) assert.equal(faceCount(hinge(deg)), 1, `${deg} deg must merge`);
  assert.equal(v.topology(hinge(0)).source, 'angle');
});

test('an unindexed mesh STOPS a face at a break sharper than 20 degrees', () => {
  for (const deg of [21, 30, 45, 60, 89]) assert.equal(faceCount(hinge(deg)), 2, `${deg} deg must split`);
});

test('a surface folded back on itself stays one face, by documented design', () => {
  // |n . n'| makes 180 deg continuous: a thin wall's two sides stay together.
  assert.equal(faceCount(hinge(180)), 1);
});

test('B-rep face ids from cascadio decide the faces when present', () => {
  const g = hinge(0);                            // one face by angle...
  g.userData.brep = { tri: [0, 1], faces: [{ type: 'plane' }, { type: 'plane' }] };
  const topo = v.topology(g);
  assert.equal(topo.source, 'brep');
  assert.deepEqual([...topo.faceId], [0, 1], '...two faces, because the STEP file says so');
});

// ---------------------------------------------------------------------------
// One pick: the size of a face.
// ---------------------------------------------------------------------------
const plate = () => new T.BoxGeometry(0.1, 0.06, 0.01);     // 100 x 60 x 10 mm, indexed per face

test('a box face is a plane with its area in mm2', () => {
  const top = planeFacing(part(plate()), 'z', 1);
  assert.ok(top, 'the top face should be a plane with a +Z normal');
  assert.ok(Math.abs(top.area - 0.006) / 0.006 < 1e-6, `area ${top.area} m2 should be 0.006 (float32 vertices)`);
  assert.equal(rowsOf(v.describe(top))['area (mesh)'], '6000 mm²');
});

test('selectFace reports the picked face through the info panel', () => {
  run('var __info = null; showInfo = d => { __info = d; };');
  const p = part(plate(), [0, 0, 0], 'PLATE');
  v.selectFace(p, 0, null);
  const info = run('__info'), rows = rowsOf(info);
  assert.equal(info.title, 'FACE');
  assert.equal(rows.part, 'PLATE');
  assert.equal(rows.triangles, '2');
  assert.equal(rows.type, 'plane');
  assert.match(rows['area (mesh)'], / mm²$/);
});

/** An open tube along Y, 64 segments: a hole's wall or a boss's skin. */
const tube = (r, h = 0.02) => new T.CylinderGeometry(r, r, h, 64, 1, true);

test('a tessellated cylinder reads its diameter to a millionth', () => {
  const e = faces(part(tube(0.005)))[0];
  assert.equal(e.geom.type, 'cylinder');
  assert.ok(Math.abs(e.geom.r - 0.005) / 0.005 < 1e-6, `r = ${e.geom.r}, want 0.005`);
  const rows = rowsOf(v.describe(e));
  assert.equal(rows.diameter, 'Ø10.00 mm');
  assert.equal(rows.radius, 'R5.000 mm');
  assert.equal(rows.source, 'fitted to the mesh');
});

test('exact B-rep data is used when it agrees with the mesh, and refused when not', () => {
  const withBrep = radius => {
    const g = tube(0.005), n = g.index.count / 3;
    g.userData.brep = { tri: new Array(n).fill(0),
      faces: [{ type: 'cylinder', origin: [0, 0, 0], axis: [0, 1, 0], radius }] };
    return faces(part(g))[0];
  };
  const good = withBrep(0.005);
  assert.equal(good.exact, true);
  assert.equal(rowsOf(v.describe(good)).source, 'exact (STEP B-rep)');
  const bad = withBrep(0.008);                   // data that does not fit the vertices
  assert.equal(bad.exact, false, 'B-rep data that disagrees with the mesh must be ignored');
  assert.ok(Math.abs(bad.geom.r - 0.005) < 1e-8, 'and the fitted radius used instead');
});

// ---------------------------------------------------------------------------
// Two picks: the distances between them.
// ---------------------------------------------------------------------------
test('two parallel planes report their normal distance, not their centres\' distance', () => {
  // The second plate sits 25 mm above AND 40 mm to the side: the gap is 25 - 10 = 15 mm
  // between the facing sides, whatever the lateral offset.
  const a = planeFacing(part(plate()), 'z', 1), b = planeFacing(part(plate(), [0.04, 0, 0.025]), 'z', -1);
  const rows = rowsOf(v.relate(a, b, v.minDistance(a, b)));
  assert.equal(rows.distance, '15.00 mm');
  assert.equal(rows.planes, 'parallel');
});

test('two parallel bores report centre distance, the wall between them, and outside to outside', () => {
  const a = faces(part(tube(0.005)))[0], b = faces(part(tube(0.008), [0.03, 0, 0]))[0];
  const rows = rowsOf(v.relate(a, b, v.minDistance(a, b)));
  assert.equal(rows['centre distance'], '30.00 mm');
  assert.equal(rows.gap, '17.00 mm', '30 - 5 - 8');
  assert.equal(rows['outside to outside'], '43.00 mm', '30 + 5 + 8');
});

test('a shaft in a bore reports the radial clearance', () => {
  const shaft = faces(part(tube(0.0049)))[0], bore = faces(part(tube(0.005)))[0];
  const rows = rowsOf(v.relate(shaft, bore, v.minDistance(shaft, bore)));
  assert.equal(rows['centre distance'], '0 (coaxial)');
  assert.equal(rows['radial clearance'], '0.100 mm');
});

test('the mesh minimum distance between two faces is the true gap', () => {
  const a = planeFacing(part(plate()), 'z', 1), b = planeFacing(part(plate(), [0, 0, 0.017]), 'z', -1);
  const md = v.minDistance(a, b);
  assert.ok(Math.abs(md.d - 0.007) < 1e-9, `min distance ${md.d} should be 0.007`);
  assert.ok(Math.abs(md.pb.z - md.pa.z - 0.007) < 1e-9, 'its end points lie on the two faces');
});

// ---------------------------------------------------------------------------
// Exploded view. README: "at 100 % a part ends up three times as far out", and
// "the distance between two parts reads the same exploded or not".
// ---------------------------------------------------------------------------
function withAssembly(fn) {
  v.ctx.__root = new T.Group();
  const a = part(plate(), [0.1, 0, 0], 'A'), b = part(plate(), [-0.05, 0, 0.02], 'B');
  v.ctx.__root.add(a.mesh, b.mesh);
  v.ctx.__root.updateMatrixWorld(true);
  v.ctx.__parts = [a, b];
  run('modelRoot = __root; parts = __parts; modelCenter = new THREE.Vector3(0, 0, 0); explodeAxis = "all";');
  try { fn(a, b); } finally { v.setExplode(0); run('modelRoot = null; parts = [];'); }
}

test('at 100 % a part sits three times as far from the centre', () => {
  withAssembly((a, b) => {
    v.setExplode(1);
    assert.ok(a.mesh.position.distanceTo(new T.Vector3(0.3, 0, 0)) < 1e-12, `A at ${a.mesh.position.toArray()}`);
    assert.ok(b.mesh.position.distanceTo(new T.Vector3(-0.15, 0, 0.06)) < 1e-12, `B at ${b.mesh.position.toArray()}`);
    v.setExplode(0);
    assert.ok(a.mesh.position.distanceTo(new T.Vector3(0.1, 0, 0)) < 1e-12, 'Reset puts it back');
  });
});

test('Along Z moves parts on Z only', () => {
  withAssembly((a, b) => {
    run('explodeAxis = "z";');
    v.setExplode(1);
    assert.ok(b.mesh.position.distanceTo(new T.Vector3(-0.05, 0, 0.06)) < 1e-12, `B at ${b.mesh.position.toArray()}`);
    assert.ok(a.mesh.position.distanceTo(new T.Vector3(0.1, 0, 0)) < 1e-12, 'A has no Z offset and stays');
  });
});

test('a distance between two parts reads the same exploded', () => {
  withAssembly((a, b) => {
    const measure = () => {
      const fa = planeFacing(a, 'z', 1), fb = planeFacing(b, 'z', -1);
      return rowsOf(v.relate(fa, fb, v.minDistance(fa, fb))).distance;
    };
    const assembled = measure();
    assert.equal(assembled, '10.00 mm');
    v.setExplode(0.7);
    assert.equal(measure(), assembled, 'measured on the assembled geometry, not where it is drawn');
  });
});

// ---------------------------------------------------------------------------
// The measure panel. A part name comes from the model file: it goes in as
// text, never as markup (the same class of bug as showInfo on PR #1).
// ---------------------------------------------------------------------------
function texts(node) {
  return [typeof node === 'string' ? node : node.textContent || '',
          ...((node && node.children) || []).flatMap(texts)];
}

test('the measure panel puts a model-supplied part name in as text, never as markup', () => {
  const hostile = "<style>@import'\\68ttps\\3a\\2f\\2fexample'</style>";
  const e = planeFacing(part(plate(), [0, 0, 0], hostile), 'z', 1);
  e.color = '#ff7a45';
  const el = run("$('measbody')");
  el.innerHTML = 'UNTOUCHED';
  v.ctx.__e = e;
  try {
    run('measA = __e; measB = null; keptItems = [];');
    v.renderMeasure();
    assert.equal(el.innerHTML, 'UNTOUCHED', 'renderMeasure wrote markup through innerHTML');
    const all = el.children.flatMap(texts);
    assert.ok(all.includes(hostile), 'the name should be present, verbatim, as text');
    assert.ok(all.includes('6000 mm²'), 'with the face\'s area row');
  } finally { run('measA = null;'); }
});
