/**
 * Unit tests for the standard views and their Ctrl+1..8 keys, Normal to
 * (src/app/00-scene.js, 48-views.js), and for exploding only the picked parts
 * (src/app/46-explode.js), on the vendored three.js itself.
 *
 *   node --test tests/views.test.mjs
 *
 * Every app module loads, in filename order, as one script (tests/harness.mjs).
 * Views are camera arithmetic and an explode is a vector per part, so both are
 * pinned here; nothing renders.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { runInContext } from 'node:vm';
import { loadViewer, ROOT } from './harness.mjs';

const MODULES = readdirSync(join(ROOT, 'src/app')).filter(f => f.endsWith('.js')).sort()
  .map(f => 'src/app/' + f);
const v = loadViewer(MODULES, ['setView', 'viewKey', 'normalTo', 'lookAtFace', 'viewUp', 'topology', 'faceEntity',
  'setExplode', 'explodeToggle', 'setExplodeScope'], { three: 'real' });
const T = v.THREE;
const run = src => runInContext(src, v.ctx);
run('modelSize = 0.1');

const near = (a, b, tol = 1e-9) => a.length === b.length && a.every((x, i) => Math.abs(x - b[i]) <= tol);
const unit = a => { const l = Math.hypot(...a); return a.map(x => x / l); };
const viewDir = () => unit(run('camera.position.clone().sub(controls.target).toArray()'));
const up = () => run('camera.up.toArray()');

function part(geometry, at = [0, 0, 0], name = 'part') {
  const mesh = new T.Mesh(geometry, new T.MeshStandardMaterial());
  mesh.position.set(...at);
  mesh.updateMatrixWorld(true);
  geometry.computeBoundingBox();
  const p = { mesh, name, restMatrix: mesh.matrixWorld.clone(), restCenter: new T.Vector3(),
              offset: new T.Vector3(), moved: new T.Vector3(), visible: true };
  geometry.boundingBox.getCenter(p.restCenter).applyMatrix4(p.restMatrix);
  return p;
}
const plate = () => new T.BoxGeometry(0.1, 0.06, 0.01);
function withModel(list, fn) {
  v.ctx.__root = new T.Group();
  list.forEach(p => v.ctx.__root.add(p.mesh));
  v.ctx.__root.updateMatrixWorld(true);
  v.ctx.__parts = list;
  run(`modelRoot = __root; parts = __parts; modelCenter = new THREE.Vector3(0, 0, 0);
       bboxCached = new THREE.Box3(new THREE.Vector3(-1, -1, -1), new THREE.Vector3(1, 1, 1));`);
  try { fn(...list); } finally {
    run(`explodeSel.clear(); explodeSign = 1; explodeAxis = 'all'; setExplodeScope('all'); setExplode(0);
         selectedFace = null; normalPickMode = false; modelRoot = null; parts = []; bboxCached = null;`);
  }
}

// ---------------------------------------------------------------------------
// Standard views: SolidWorks' names, Y up, +Z towards the viewer in Front.
// ---------------------------------------------------------------------------
const EXPECT = {
  front: [[0, 0, 1], [0, 1, 0]], rear: [[0, 0, -1], [0, 1, 0]],
  top: [[0, 1, 0], [0, 0, -1]], bottom: [[0, -1, 0], [0, 0, 1]],
  left: [[-1, 0, 0], [0, 1, 0]], right: [[1, 0, 0], [0, 1, 0]],
};
test('each standard view looks from its side with its own up', () => {
  withModel([part(plate())], () => {
    for (const [k, [d, u]] of Object.entries(EXPECT)) {
      v.setView(k);
      assert.ok(near(viewDir(), d, 1e-9), `${k}: camera direction ${viewDir()}`);
      assert.ok(near(up(), u, 0), `${k}: up ${up()}`);
    }
  });
});

const key = (code, mods = { ctrlKey: true }) => {
  const e = { code, target: { tagName: 'CANVAS' }, prevented: false, preventDefault() { this.prevented = true; }, ...mods };
  return [v.viewKey(e), e];
};
test('Ctrl+1 … Ctrl+6 are Front, Rear, Top, Bottom, Left, Right, by key position', () => {
  withModel([part(plate())], () => {
    const order = ['front', 'rear', 'top', 'bottom', 'left', 'right'];
    order.forEach((k, i) => {
      const [handled, e] = key('Digit' + (i + 1));
      assert.ok(handled && e.prevented, `Ctrl+${i + 1} must be taken from the browser`);
      assert.ok(near(viewDir(), EXPECT[k][0], 1e-9), `Ctrl+${i + 1} should be ${k}, got ${viewDir()}`);
    });
    key('Numpad3');
    assert.ok(near(viewDir(), EXPECT.top[0], 1e-9), 'the numpad digits work too');
  });
});
test('the view keys leave plain digits, Alt and fields alone', () => {
  withModel([part(plate())], () => {
    assert.equal(key('Digit1', {})[0], false, 'a plain 1 is Part mode, not a view');
    assert.equal(key('Digit1', { ctrlKey: true, altKey: true })[0], false);
    const e = { code: 'Digit2', ctrlKey: true, target: { tagName: 'INPUT' }, preventDefault() {} };
    assert.equal(v.viewKey(e), false, 'typing in a field is not a view change');
  });
});

// ---------------------------------------------------------------------------
// Normal to: square to the face, from the side it is seen; again flips.
// ---------------------------------------------------------------------------
const faceOf = (p, axis, sign) => {
  const topo = v.topology(p.mesh.geometry), n = Math.max(...topo.faceId) + 1;
  return Array.from({ length: n }, (_, f) => v.faceEntity(p, f, null))
    .find(e => e.geom.type === 'plane' && Math.abs(e.geom.n[axis] - sign) < 1e-9);
};
test('Normal to a flat face looks along its normal from outside, and again from behind', () => {
  withModel([part(plate())], p => {
    v.setView('iso');                                  // the +X face is in sight from the iso corner
    v.ctx.__f = faceOf(p, 'x', 1);
    run('selectedFace = __f;');
    v.normalTo();
    assert.ok(near(viewDir(), [1, 0, 0], 1e-9), `square to the +X face, got ${viewDir()}`);
    assert.ok(near(up(), [0, 1, 0], 1e-9), `upright, got ${up()}`);
    v.normalTo();
    assert.ok(near(viewDir(), [-1, 0, 0], 1e-9), `asked again, from the other side, got ${viewDir()}`);
  });
});
test('Normal to a face looking up uses the Top view\'s up', () => {
  withModel([part(plate())], p => {
    v.setView('iso');
    v.ctx.__f = faceOf(p, 'y', 1);
    run('selectedFace = __f;');
    v.normalTo();
    assert.ok(near(viewDir(), [0, 1, 0], 1e-9) && near(up(), [0, 0, -1], 1e-9), `got ${viewDir()} / ${up()}`);
  });
});
test('a face seen from behind is looked at from the side it was seen', () => {
  withModel([part(plate())], p => {
    v.setView('rear');                                 // camera on -Z, just behind the +X face's plane
    v.lookAtFace(faceOf(p, 'x', 1), null);
    assert.ok(near(viewDir(), [-1, 0, 0], 1e-9), `stays on the side it was seen from, got ${viewDir()}`);
  });
});
test('an oblique normal keeps world Y upright, square to the view', () => {
  const d = new T.Vector3(1, 1, 0).normalize(), u = v.viewUp(d, new T.Vector3());
  assert.ok(Math.abs(u.dot(d)) < 1e-12 && u.y > 0 && Math.abs(u.length() - 1) < 1e-12, `up ${u.toArray()}`);
});

// ---------------------------------------------------------------------------
// Explode only the picked parts: one rigid group, along the chosen direction.
// ---------------------------------------------------------------------------
test('Picked scope moves only the picked parts, together, along X; Flip sends them the other way', () => {
  const a = part(plate(), [0.1, 0, 0], 'A'), b = part(plate(), [-0.05, 0, 0.02], 'B'), c = part(plate(), [0, 0.03, 0], 'C');
  withModel([a, b, c], () => {
    v.explodeToggle(a); v.explodeToggle(b);
    assert.equal(run('explodeScope'), 'picked', 'the first pick switches the scope');
    run("explodeAxis = 'x';");
    v.setExplode(0.5);                                 // half of one model size (0.1): 0.05 on +X
    assert.ok(near(a.offset.toArray(), [0.05, 0, 0], 1e-12), `A by ${a.offset.toArray()}`);
    assert.ok(near(b.offset.toArray(), [0.05, 0, 0], 1e-12), `B by the same vector, got ${b.offset.toArray()}`);
    assert.ok(near(c.offset.toArray(), [0, 0, 0], 0), `C, not picked, stays assembled, got ${c.offset.toArray()}`);
    run("explodeSign = -1; applyExplode();");
    assert.ok(near(a.offset.toArray(), [-0.05, 0, 0], 1e-12), `Flip: -X, got ${a.offset.toArray()}`);
  });
});
test('Picked with All moves the group away from the centre through its own centre', () => {
  const a = part(plate(), [0.1, 0, 0], 'A'), b = part(plate(), [0.1, 0.06, 0], 'B'), c = part(plate(), [-0.1, 0, 0], 'C');
  withModel([a, b, c], () => {
    v.explodeToggle(a); v.explodeToggle(b);
    v.setExplode(1);
    const g = unit([0.1, 0.03, 0]).map(x => x * 0.1);
    assert.ok(near(a.offset.toArray(), g, 1e-12) && near(b.offset.toArray(), g, 1e-12), `group by ${a.offset.toArray()}`);
    assert.ok(near(c.offset.toArray(), [0, 0, 0], 0), 'C stays');
    v.explodeToggle(b);                                // un-picked: back home
    assert.ok(near(b.offset.toArray(), [0, 0, 0], 0), `B taken out of the group goes back, got ${b.offset.toArray()}`);
  });
});
test('scope All keeps the original explode for every part', () => {
  const a = part(plate(), [0.1, 0, 0], 'A'), b = part(plate(), [-0.05, 0, 0.02], 'B');
  withModel([a, b], () => {
    v.explodeToggle(a);
    v.setExplodeScope('all');
    v.setExplode(1);
    assert.ok(near(a.offset.toArray(), [0.2, 0, 0], 1e-12) && near(b.offset.toArray(), [-0.1, 0, 0.04], 1e-12),
      `${a.offset.toArray()} / ${b.offset.toArray()}`);
  });
});
