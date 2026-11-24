/**
 * Unit tests for looking square at a plane (Normal to clicking a reference or datum plane,
 * src/app/48-views.js) and for the plane through an axis turned by an angle (src/app/76-datum.js),
 * on the vendored three.js itself.
 *
 *   node --test tests/datum.test.mjs
 *
 * The plane's normal is arithmetic and a click is a ray against sheets, so both are pinned here;
 * nothing renders.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runInContext } from 'node:vm';
import { loadViewer, ROOT } from './harness.mjs';

const MODULES = readdirSync(join(ROOT, 'src/app')).filter(f => f.endsWith('.js')).sort()
  .map(f => 'src/app/' + f);
const v = loadViewer(MODULES, [], { three: 'real' });
const T = v.THREE;
const run = src => runInContext(src, v.ctx);
run('modelSize = 0.1');

const near = (a, b, tol = 1e-9) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= tol);
const unit = a => { const l = Math.hypot(...a); return a.map(x => x / l); };
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const viewDir = () => unit(run('camera.position.clone().sub(controls.target).toArray()'));
// datumNormal wants unit vectors, as the panel always has: normalise what a test types
const normal = (a, r, deg) => run(`(n => n && n.toArray())(datumNormal(new THREE.Vector3(${a}).normalize(), new THREE.Vector3(${r}).normalize(), ${deg}))`);

function part(at = [0, 0, 0], name = 'part') {
  const geometry = new T.BoxGeometry(0.1, 0.06, 0.01);
  const mesh = new T.Mesh(geometry, new T.MeshStandardMaterial());
  mesh.position.set(...at);
  mesh.updateMatrixWorld(true);
  geometry.computeBoundingBox();
  const p = { mesh, name, restMatrix: mesh.matrixWorld.clone(), restCenter: new T.Vector3(),
              offset: new T.Vector3(), moved: new T.Vector3(), visible: true };
  geometry.boundingBox.getCenter(p.restCenter).applyMatrix4(p.restMatrix);
  return p;
}
function withModel(list, fn) {
  v.ctx.__root = new T.Group();
  list.forEach(p => v.ctx.__root.add(p.mesh));
  v.ctx.__root.updateMatrixWorld(true);
  v.ctx.__parts = list;
  run(`modelRoot = __root; parts = __parts; modelCenter = new THREE.Vector3(0, 0, 0);
       bboxCached = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));
       __toasts = []; __t = toast; toast = m => __toasts.push(m);`);
  try { fn(...list); } finally {
    run(`toast = __t; datumReset(); setPlanes(false); disposePlanes(); normalPickMode = false;
         selectedFace = null; modelRoot = null; parts = []; bboxCached = null; camera.up.set(0, 1, 0);`);
  }
}
// aim the pick ray from `o` along `d` (both in world units)
const ray = (o, d) => run(`raycaster.set(new THREE.Vector3(${o}), new THREE.Vector3(${d}).normalize())`);
const lookFrom = pos => run(`camera.position.set(${pos}); controls.target.set(0, 0, 0); camera.up.set(0, 1, 0)`);
const setDatum = (axis, ref, deg, part = 0) => {
  run(`datumAxis = {o:new THREE.Vector3(0.1, 0, 0), d:new THREE.Vector3(${axis}).normalize(), part:parts[${part}], geom:{type:'cylinder', r:0.01}, exact:true};
       datumRef = {name:'${ref[0]}', n:new THREE.Vector3(${ref[1]}), exact:true}; datumAngle = ${deg}; datumChanged();`);
};

// ---------------------------------------------------------------------------
// The arithmetic: a plane through the axis, turned about it from a reference.
// ---------------------------------------------------------------------------
test('0° is the plane through the axis parallel to the reference; + turns right-handed about the axis', () => {
  assert.ok(near(normal('0, 0, 1', '0, 1, 0', 0), [0, 1, 0]), 'Z axis from Top: 0 deg is Top itself');
  assert.ok(near(normal('0, 0, 1', '0, 1, 0', 90), [-1, 0, 0], 1e-12), '+90 turns Top into the plane facing -X');
  assert.ok(near(normal('0, 0, 1', '0, 1, 0', -90), [1, 0, 0], 1e-12), '-90 is the other way');
  assert.ok(near(normal('0, 0, 1', '0, 1, 0', 180), [0, -1, 0], 1e-12), '180 is the same plane, the other way up');
});
test('the plane always holds the axis, and leans the typed angle from the reference when the axis is parallel to it', () => {
  for (const [a, r] of [['1, 0, 0', '0, 1, 0'], ['0, 1, 0', '0, 0, 1'], ['0, 0, 1', '1, 0, 0'], ['1, 1, 0', '0, 0, 1'], ['1, 2, -2', '2, -1, 0']]) {
    for (const deg of [0, 17, 45, 90, 133, -60]) {
      const n = normal(a, r, deg), au = unit(a.split(',').map(Number)), ru = unit(r.split(',').map(Number));
      assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-12, `unit: ${n}`);
      assert.ok(Math.abs(dot(n, au)) < 1e-12, `${a} from ${r} at ${deg}: holds the axis, n.a = ${dot(n, au)}`);
      if (Math.abs(dot(au, ru)) < 1e-12) {            // axis parallel to the reference: the dihedral angle is the typed one
        const got = Math.atan2(Math.hypot(...cross(n, ru)), Math.abs(dot(n, ru))) * 180 / Math.PI, want = Math.abs(((deg + 90) % 180) - 90);
        assert.ok(Math.abs(got - want) < 1e-9, `${a} from ${r} at ${deg}: leans ${got}, wanted ${want}`);
      }
    }
  }
});
test('an axis that crosses the reference starts from the plane through it closest to the reference', () => {
  const n = normal('1, 0, 1', '0, 0, 1', 0), s = Math.SQRT1_2;
  assert.ok(near(n, [-0.5 / Math.hypot(0.5, 0.5), 0, 0.5 / Math.hypot(0.5, 0.5)], 1e-12), `${n}`);   // r minus its part along a
  assert.ok(Math.abs(dot(n, [s, 0, s])) < 1e-12, 'and it holds the axis');
});
test('an axis square to the reference has no angle to measure from', () => {
  assert.equal(normal('0, 0, 1', '0, 0, 1', 30), null, 'exactly square');
  assert.equal(normal('0, 0, 1', '0, 0.005, 1', 30), null, 'within 0.6 degrees of square');
  assert.ok(normal('0, 0, 1', '0, 0.05, 1', 30), 'a couple of degrees off is fine');
});

// ---------------------------------------------------------------------------
// Making one: pick the axis, the reference, set the angle.
// ---------------------------------------------------------------------------
test('Axis Pick…: a cylinder gives its axis, + along the world direction it mostly points, through the point nearest the model centre', () => {
  withModel([part([0.3, 0, 0])], p => {
    v.ctx.__ent = { part: p, hit: new T.Vector3(0.11, 0, 0.02), exact: true,
                    geom: { type: 'cylinder', p: new T.Vector3(0.1, 0, 0), a: new T.Vector3(0, 0, -1), r: 0.01 } };
    run('entityAt = () => __ent; datumPick("axis");');
    assert.equal(run('datumPickMode'), 'axis');
    run('pickDatum({});');
    assert.equal(run('datumPickMode'), null, 'the pick is taken');
    assert.ok(near(run('datumAxis.d.toArray()'), [0, 0, 1], 1e-12), `+Z, got ${run('datumAxis.d.toArray()')}`);
    assert.ok(near(run('datumAxis.o.toArray()'), [0.1, 0, 0], 1e-12), `foot of the centre, not of the click: ${run('datumAxis.o.toArray()')}`);
  });
});
test('Axis Pick…: a flat face is no axis, and says so; Face…: only a flat face is a reference', () => {
  withModel([part()], p => {
    v.ctx.__plane = { part: p, hit: new T.Vector3(), exact: false, geom: { type: 'plane', p: new T.Vector3(), n: new T.Vector3(0, -2, 0) } };
    run('entityAt = () => __plane; datumPick("axis"); pickDatum({});');
    assert.equal(run('datumAxis'), null);
    assert.equal(run('__toasts.length'), 1);
    assert.equal(run('datumPickMode'), 'axis', 'still waiting for an axis');
    run('datumPick("face"); pickDatum({});');
    assert.ok(near(run('datumRef.n.toArray()'), [0, -1, 0]), 'normalised');
    assert.equal(run('datumRef.name'), 'face');
    assert.equal(run('datumRef.exact'), false, 'a mesh-fitted face says so');
    v.ctx.__line = { part: p, hit: new T.Vector3(), geom: { type: 'line', p0: new T.Vector3(), p1: new T.Vector3(1, 0, 0), d: new T.Vector3(1, 0, 0), len: 1 } };
    run('entityAt = () => __line; datumPick("face"); pickDatum({});');
    assert.equal(run('datumPickMode'), 'face', 'an edge is not a face: still waiting');
  });
});
test('the plane is drawn through the axis at the angle, and Look turns the view square to it with the axis upright', () => {
  withModel([part()], () => {
    setDatum('0, 0, 1', ['Top', '0, 1, 0'], 30);
    assert.equal(run('datumNodes.length'), 1, 'drawn at once');
    const n = normal('0, 0, 1', '0, 1, 0', 30);
    const sheet = run('datumNodes[0].children.find(o => o.isMesh)');
    const pos = Array.from(sheet.geometry.attributes.position.array);
    for (let i = 0; i < pos.length; i += 3) {
      const q = [pos[i] - 0.1, pos[i + 1], pos[i + 2]];
      assert.ok(Math.abs(dot(q, n)) < 1e-6, `corner ${i / 3} lies on the plane through (0.1, 0, 0)`);
    }
    const zs = pos.filter((_, i) => i % 3 === 2);
    assert.ok(Math.min(...zs) < -0.07 && Math.max(...zs) > 0.07, 'reaches 0.75 model sizes either way along the axis');
    lookFrom('0.5, 0.4, 3');
    run('datumLook();');
    const d = viewDir();
    assert.ok(Math.abs(dot(d, n)) > 1 - 1e-9, 'looking along the normal');
    assert.ok(dot(d, [0.5 - 0.1, 0.4, 3]) > 0, 'from the side the camera was on');
    assert.ok(near(run('camera.up.toArray()'), [0, 0, 1], 1e-9), `the axis (Z) stands upright: ${run('camera.up.toArray()')}`);
    run('datumLook();');
    assert.ok(dot(viewDir(), d) < -1 + 1e-9, 'asked again while square: from the other side');
  });
});
test('Look keeps an upside-down view upside down, rather than flipping the axis the other way up', () => {
  withModel([part()], () => {
    setDatum('0, 1, 0', ['Front', '0, 0, 1'], 40);
    lookFrom('3, 0.2, 1');
    run('camera.up.set(0, -1, 0); datumLook();');
    assert.ok(near(run('camera.up.toArray()'), [0, -1, 0], 1e-9), `${run('camera.up.toArray()')}`);
  });
});
test('an axis that crosses the reference is not claimed to be at the typed angle from it: label and toast say what the angle is of', () => {
  withModel([part()], () => {
    // axis 30 deg out of Front (normal Z): 30 deg about it is 41.4 deg between the planes, not 30
    setDatum('1, 0, 0.5773502691896257', ['Front', '0, 0, 1'], 30);
    const d = run('datumDesc(datumPlane())');
    assert.match(d, /about the axis from the plane nearest Front \(axis 30\.0° off it\)/, d);
    const n = normal('1, 0, 0.5773502691896257', '0, 0, 1', 30), dihedral = Math.acos(Math.abs(n[2])) * 180 / Math.PI;
    assert.ok(Math.abs(dihedral - 41.4) < 0.1, `the planes really are ${dihedral} apart, not 30`);
    assert.match(run('datumNodes[0].children.find(o => o.isMesh).userData.title'), /about the axis from the plane nearest Front/);
    setDatum('1, 0, 0', ['Front', '0, 0, 1'], 30);          // parallel: the plain wording, and it is the true angle
    assert.equal(run('datumDesc(datumPlane())'), '30° from Front');
  });
});
test('a pick fitted to the mesh is not trusted to be near square, says (mesh), and the angle box agrees with the slider', () => {
  withModel([part()], () => {
    const tilted = '0.0349, 0, 0.9994';                        // 2 degrees off square to Front
    setDatum(tilted, ['Front', '0, 0, 1'], 30);
    assert.ok(run('datumPlane()'), 'an exact pick that tilted is a real tilt');
    run('datumAxis.exact = false; datumChanged();');
    assert.equal(run('datumPlane()'), null, 'a mesh fit that near square has no trusted zero direction');
    setDatum('1, 0, 0', ['Front', '0, 0, 1'], 30);
    run('datumAxis.exact = false; datumChanged();');
    assert.match(run('datumDesc(datumPlane())'), /\(mesh\)$/);
    run('setDatumAngle("270");');
    assert.equal(run('datumAngle'), -90, 'beyond the slider: the same turn, in its range');
    run('setDatumAngle("180");');
    assert.equal(run('datumAngle'), 180);
  });
});
test('Keep leaves the plane there as P1, P2 … without drawing the one just kept twice; Clear takes them all away', () => {
  withModel([part()], () => {
    setDatum('0, 0, 1', ['Top', '0, 1, 0'], 30);
    run('datumKeep();');
    assert.equal(run('datumKept.map(k => k.name).join()'), 'P1');
    assert.equal(run('datumNodes.length'), 1, 'the draft is the kept plane: one sheet');
    run('setDatumAngle("60");');
    assert.equal(run('datumNodes.length'), 2, 'a new angle: kept one, and the new one');
    run('datumKeep(); setDatumAngle("-20");');
    assert.equal(run('datumKept.map(k => k.name).join()'), 'P1,P2');
    assert.equal(run('datumNodes.length'), 3);
    assert.ok(run('datumNodes.every(g => scene.children.includes(g))'), 'in the scene, not in the model');
    run('datumClear();');
    assert.equal(run('datumNodes.length + datumKept.length + scene.children.filter(o => /^datum plane/.test(o.name)).length'), 0);
  });
});
test('a bad angle is refused and the box goes back to the last good one', () => {
  withModel([part()], () => {
    setDatum('0, 0, 1', ['Top', '0, 1, 0'], 30);
    run('setDatumAngle("abc"); setDatumAngle("1e9");');
    assert.equal(run('datumAngle'), 30);
    run('setDatumAngle("12,5");');
    assert.equal(run('datumAngle'), 12.5, 'a decimal comma is a decimal point');
  });
});
test('a plane follows the part its axis was picked on while the assembly is exploded', () => {
  const p = part([0.3, 0, 0]);
  withModel([p], () => {
    setDatum('0, 0, 1', ['Top', '0, 1, 0'], 30);
    p.offset.set(0.2, 0, 0.1);
    run('followers.forEach(o => { const fl = o.userData.follow; o.position.copy(fl.part.offset).sub(fl.base); });');
    assert.ok(near(run('datumNodes[0].position.toArray()'), [0.2, 0, 0.1]));
    run('datumReset();');
    assert.equal(run('followers.size'), 0, 'a new model leaves nothing following');
  });
});
test('opening another model forgets the planes made through the old one\'s axes', () => {
  withModel([part()], () => {
    setDatum('0, 0, 1', ['Top', '0, 1, 0'], 30);
    run('datumKeep(); datumPick("axis");');
    run('clearModel();');
    assert.equal(run('datumKept.length + datumNodes.length + (datumAxis ? 1 : 0) + (datumRef ? 1 : 0)'), 0);
    assert.equal(run('datumPickMode'), null);
    assert.equal(run('scene.children.filter(o => /^datum plane/.test(o.name)).length'), 0, 'nothing left in the scene');
  });
});
test('the panel says when the axis is square to the reference, and Look and Keep wait for a plane', () => {
  withModel([part()], () => {
    setDatum('0, 0, 1', ['Front', '0, 0, 1'], 30);
    assert.equal(run('datumPlane()'), null);
    assert.equal(run('datumNodes.length'), 0, 'nothing to draw');
    assert.match(run('$("datumHint").textContent'), /square to that reference/);
    lookFrom('0.5, 0.4, 3');
    run('datumLook(); datumKeep();');                  // no plane: neither does anything
    assert.ok(near(run('camera.position.toArray()'), [0.5, 0.4, 3]), 'the view stays');
    assert.equal(run('datumKept.length'), 0);
    run('datumRef = {name:"Top", n:new THREE.Vector3(0, 1, 0), exact:true}; datumChanged();');
    assert.equal(run('datumNodes.length'), 1, 'another reference: a plane');
  });
});
test('starting the datum plane\'s pick ends the other pick modes, and any other ends it', () => {
  withModel([part()], () => {
    run('normalPickMode = true; datumPick("axis");');
    assert.equal(run('normalPickMode'), false);
    assert.equal(run('datumPickMode'), 'axis');
    assert.equal(run('pickModeOn()'), true, 'a pick mode keeps the move handle from taking its click');
    run('datumPick("axis");');
    assert.equal(run('datumPickMode'), null, 'pressing it again cancels');
    run('datumPick("face"); endPickModes();');
    assert.equal(run('datumPickMode'), null, 'Normal to … and the rest end it');
    run('datumPick("axis"); normalTo();');
    assert.equal(run('datumPickMode'), null);
    assert.equal(run('normalPickMode'), true);
  });
});

// ---------------------------------------------------------------------------
// Normal to a plane: the nearer of the plane and the face under the click.
// ---------------------------------------------------------------------------
test('Normal to a reference plane that is shown: a click on its sheet looks square at it', () => {
  withModel([part()], () => {
    run('setPlanes(true); scene.updateMatrixWorld(true);');
    lookFrom('0.5, 0.5, 3');
    ray('0.2, 0.02, 2', '0, 0, -1');                      // past the plate: only the Front sheet is there
    run('normalPickMode = true; pickNormal();');
    assert.ok(near(viewDir(), [0, 0, 1], 1e-9), `Front is looked at from +Z: ${viewDir()}`);
    assert.equal(run('normalPickMode'), false, 'the pick is taken');
    assert.match(run('__toasts.at(-1)'), /Front plane \(XY\)/);
    ray('0.2, 0.02, -2', '0, 0, 1');
    run('normalPickMode = true; pickNormal();');
    assert.ok(near(viewDir(), [0, 0, -1], 1e-9), 'square to it already: asked again, it looks from the other side: ' + viewDir());
  });
});
test('Normal to a reference plane: seen from behind it is looked at from behind', () => {
  withModel([part()], () => {
    run('setPlanes(true); scene.updateMatrixWorld(true);');
    lookFrom('0.5, 0.5, -3');
    ray('0.2, 0.02, -2', '0, 0, 1');
    run('normalPickMode = true; pickNormal();');
    assert.ok(near(viewDir(), [0, 0, -1], 1e-9), `${viewDir()}`);
  });
});
test('a reference plane that is hidden cannot be clicked', () => {
  withModel([part()], () => {
    run('setPlanes(true); scene.updateMatrixWorld(true); setPlanes(false);');
    ray('0.2, 0.02, 2', '0, 0, -1');
    assert.equal(run('planeHit()'), null);
    lookFrom('0.5, 0.5, 3');
    run('normalPickMode = true; pickNormal();');
    assert.equal(run('normalPickMode'), true, 'nothing there: still waiting');
    assert.match(run('__toasts.at(-1)'), /No face there/);
  });
});
test('the nearer of a plane and a face wins the click', () => {
  withModel([part([0, 0, -0.2])], () => {                  // the plate lies behind the Front plane, seen from +Z
    run('setPlanes(true); scene.updateMatrixWorld(true);');
    lookFrom('3, 0.3, 3');
    ray('0.01, 0.02, 2', '0, 0, -1');                       // plane at z = 0, plate's face at z = -0.195
    run('normalPickMode = true; pickNormal();');
    assert.match(run('__toasts.at(-1)'), /Front plane/, 'the plane is in front: it is what is looked at');
  });
  withModel([part([0, 0, 0])], () => {                     // the plate's +X face is met before the plane
    run('setPlanes(true); scene.updateMatrixWorld(true);');
    lookFrom('3, 0.3, 3');
    ray('2, 0.01, 0.1', '-1, 0, -0.05');
    run('normalPickMode = true; pickNormal();');
    assert.ok(near(viewDir(), [1, 0, 0], 1e-9), `the face is in front: looked at along X, got ${viewDir()}`);
    assert.doesNotMatch(run('__toasts.at(-1)'), /plane/);
  });
});
test('a plane made through an axis can be clicked too, and the axis stands upright', () => {
  withModel([part()], () => {
    setDatum('0, 0, 1', ['Top', '0, 1, 0'], 90);          // the plane x = 0.1, facing -X
    run('scene.updateMatrixWorld(true);');
    lookFrom('2, 0.3, 0.2');
    ray('3, 0.02, 0.02', '-1, 0, 0');
    run('normalPickMode = true; pickNormal();');
    assert.ok(near(viewDir(), [1, 0, 0], 1e-9), `from the +X side: ${viewDir()}`);
    assert.ok(near(run('camera.up.toArray()'), [0, 0, 1], 1e-9), 'Z up');
    assert.match(run('__toasts.at(-1)'), /90° from Top/);
  });
});

// ---------------------------------------------------------------------------
// Through: Two axes -- the plane holding two parallel axes (src/app/77-datum2.js).
// ---------------------------------------------------------------------------
const setAxes = (o1, d1, o2, d2, { exact1 = true, exact2 = true, part2 = 0 } = {}) => {
  run(`setDatumMode('two');
       datumAxis = {o:new THREE.Vector3(${o1}), d:new THREE.Vector3(${d1}).normalize(), part:parts[0], geom:{type:'cylinder', r:0.005}, exact:${exact1}};
       datumAxis2 = {o:new THREE.Vector3(${o2}), d:new THREE.Vector3(${d2}).normalize(), part:parts[${part2}], geom:{type:'cylinder', r:0.004}, exact:${exact2}};
       datumChanged();`);
};
test('two parallel axes: the plane holds both, centred midway between them', () => {
  withModel([part()], () => {
    setAxes('0, 0, 0', '0, 0, 1', '0.03, 0.04, 0.02', '0, 0, 1');
    const n = run('datumPlane().n.toArray()');
    // the plane through two Z axes at (0,0) and (0.03,0.04): normal square to Z and to (0.6, 0.8, 0)
    assert.ok(near(n.map(Math.abs), [0.8, 0.6, 0], 1e-12), `normal ${n}`);
    for (const p of [[0, 0, 0], [0.03, 0.04, 0.02], [0.03, 0.04, -5]])
      assert.ok(Math.abs(dot(n, p)) < 1e-12, `${p} lies in the plane`);
    assert.ok(near(run('datumPlane().o.toArray()'), [0.015, 0.02, 0], 1e-12), 'midway, square across from the first axis point');
    assert.ok(Math.abs(run('twoAxisFit(datumAxis, datumAxis2).dist') - 0.05) < 1e-12, '0.05 apart, along Z ignored');
    assert.equal(run('datumNodes.length'), 1, 'drawn at once');
    assert.equal(run('datumDesc(datumPlane())'), 'through two axes');
    assert.match(run('$("datumHint").textContent'), /50\.00 mm apart\.$/);
  });
});
test('two axes picked pointing opposite ways are still parallel; the plane runs along the first one', () => {
  withModel([part()], () => {
    setAxes('0, 0, 0', '1, 0, 0', '0, 0.02, 0', '-1, 0, 0');
    assert.ok(run('datumPlane()'), 'antiparallel is parallel');
    assert.ok(near(run('datumPlane().a.toArray()'), [1, 0, 0], 1e-12));
    assert.ok(near(run('datumPlane().n.toArray()').map(Math.abs), [0, 0, 1], 1e-12), 'the XY plane through both');
  });
});
test('axes that are not parallel, or are one line, give no plane, and the panel says why', () => {
  withModel([part()], () => {
    setAxes('0, 0, 0', '0, 0, 1', '0.02, 0, 0', '0, 0.01, 1');
    assert.equal(run('datumPlane()'), null, '0.57° apart is not parallel for B-rep axes');
    assert.match(run('$("datumHint").textContent'), /0\.57° apart, not parallel/);
    run('datumAxis2.exact = false; datumChanged();');
    assert.ok(run('datumPlane()'), 'a mesh fit is that uncertain: taken as parallel');
    assert.match(run('$("datumHint").textContent'), /\(mesh\), along their mean direction: they are 0\.57° off parallel, so the gap .* is not given\.$/);
    assert.doesNotMatch(run('$("datumHint").textContent'), /mm apart/, 'no one distance for axes that far off parallel');
    assert.match(run('datumDesc(datumPlane())'), /\(mesh\)$/);
    setAxes('0, 0, 0', '0, 0, 1', '0, 0, 0.05', '0, 0, -1');
    assert.equal(run('datumPlane()'), null, 'the same line: no one plane');
    assert.match(run('$("datumHint").textContent'), /one line/);
  });
});
test('the tolerances: B-rep axes 0.05° apart are not parallel, mesh axes 5° apart neither; mesh axes 2 µm apart are one line', () => {
  withModel([part()], () => {
    const t = Math.sin(0.05 * Math.PI / 180) / Math.cos(0.05 * Math.PI / 180);
    setAxes('0, 0, 0', '0, 0, 1', '0.02, 0, 0', `0, ${t}, 1`);
    assert.equal(run('datumPlane()'), null, 'exact axes 0.05° apart');
    run('datumAxis2.exact = false; datumChanged();');
    assert.ok(run('datumPlane()'), 'the same pair fitted to the mesh is parallel within its uncertainty');
    assert.match(run('$("datumHint").textContent'), /20\.00 mm apart \(mesh\)\.$/, 'and 0.05° is close enough to give the gap');
    const t5 = Math.tan(5 * Math.PI / 180);
    setAxes('0, 0, 0', '0, 0, 1', '0.02, 0, 0', `0, ${t5}, 1`, { exact1: false, exact2: false });
    assert.equal(run('datumPlane()'), null, 'mesh axes 5° apart');
    setAxes('0, 0, 0', '0, 0, 1', '0.000002, 0, 0.03', '0, 0, 1', { exact1: false, exact2: false });
    assert.equal(run('datumPlane()'), null, 'two mesh fits of one bore, 2 µm apart, are one line');
    assert.match(run('$("datumHint").textContent'), /one line/);
    run('datumAxis.exact = datumAxis2.exact = true; datumChanged();');
    assert.ok(run('datumPlane()'), 'two B-rep axes 2 µm apart are two axes');
  });
});
test('axes on two parts: the plane says it is through them as assembled', () => {
  withModel([part(), part([0.2, 0, 0], 'other')], () => {
    setAxes('0, 0, 0', '0, 0, 1', '0.03, 0, 0', '0, 0, 1', { part2: 1 });
    assert.equal(run('datumDesc(datumPlane())'), 'through two axes as assembled');
    assert.match(run('$("datumHint").textContent'), /on two parts: the plane is through them as assembled/);
    setAxes('0, 0, 0', '0, 0, 1', '0.03, 0, 0', '0, 0, 1');
    assert.equal(run('datumDesc(datumPlane())'), 'through two axes');
  });
});
test('Axis 2 Pick… takes the second axis; the mode switch ends its pick and keeps the first axis', () => {
  withModel([part()], p0 => {
    run('setDatumMode("two")');
    assert.equal(run('datumMode'), 'two');
    v.ctx.__ent = { part: p0, exact: true, hit: new T.Vector3(0.03, 0, 0.01),
                    geom: { type: 'line', p0: new T.Vector3(0.03, 0, -0.01), p1: new T.Vector3(0.03, 0, 0.03),
                            d: new T.Vector3(0, 0, -1), len: 0.04 } };
    run('entityAt = () => __ent; datumPick("axis2"); pickDatum({});');
    assert.equal(run('datumPickMode'), null);
    assert.ok(near(run('datumAxis2.d.toArray()'), [0, 0, 1], 1e-12), '+ along +Z');
    assert.equal(run('datumAxis'), null, 'the first axis is not touched');
    run('datumPick("axis2"); setDatumMode("angle");');
    assert.equal(run('datumPickMode'), null, 'leaving Two axes ends its pick');
    assert.equal(run('datumMode'), 'angle');
    run('datumClear();');
    assert.equal(run('datumAxis2'), null);
  });
});
test('Keep names a two-axis plane P1 like any other; a new model forgets the second axis', () => {
  withModel([part()], () => {
    setAxes('0, 0, 0', '0, 1, 0', '0.04, 0, 0', '0, 1, 0');
    run('datumKeep();');
    assert.equal(run('datumKept.map(k => k.name).join()'), 'P1');
    assert.equal(run('datumNodes.length'), 1);
    assert.match(run('datumNodes[0].children.find(o => o.isMesh).userData.title'), /through two axes/);
    run('datumReset();');
    assert.equal(run('datumKept.length + (datumAxis2 ? 1 : 0)'), 0);
  });
});
