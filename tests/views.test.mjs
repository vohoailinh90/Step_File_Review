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
const v = loadViewer(MODULES, ['setView', 'endPickModes', 'viewKey', 'normalTo', 'lookAtFace', 'viewUp', 'topology', 'faceEntity',
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
  withModel([part(plate())], () => {
    v.setView('front');
    const d = new T.Vector3(1, 1, 0).normalize(), u = v.viewUp(d, new T.Vector3());
    assert.ok(Math.abs(u.dot(d)) < 1e-12 && u.y > 0 && Math.abs(u.length() - 1) < 1e-12, `up ${u.toArray()}`);
  });
});

/** Look at the origin from `pos` with `u` up, as a drag would leave it. */
function look(pos, u) {
  Object.assign(v.ctx, { __p: pos, __u: u });
  run('orbitStop(); controls.target.set(0, 0, 0); camera.position.set(...__p); camera.up.set(...__u); camera.lookAt(controls.target); camera.updateMatrixWorld();');
}
test('Normal to keeps the orientation the view already has: Z up, looking near X, lands on ZY with Z up', () => {
  withModel([part(plate())], p => {
    look([5, -1.5, 1.2], [0, 0, 1]);                 // the owner's screenshot: Z up the screen, Y to the right
    v.lookAtFace(faceOf(p, 'x', 1), null);
    assert.ok(near(viewDir(), [1, 0, 0], 1e-9), `square to the +X face, got ${viewDir()}`);
    assert.ok(near(up(), [0, 0, 1], 1e-9), `Z stays up, not turned to Y, got ${up()}`);
    v.lookAtFace(faceOf(p, 'x', 1), null);            // again: from behind, still Z up
    assert.ok(near(viewDir(), [-1, 0, 0], 1e-9) && near(up(), [0, 0, 1], 1e-9), `flipped: ${viewDir()} / ${up()}`);
  });
});
test('Normal to a face looking up from a view near the front tips over with the far side at the top', () => {
  withModel([part(plate())], p => {
    look([0.3, 2, 5], [0, 1, 0]);                    // near Front, a little from above
    v.lookAtFace(faceOf(p, 'y', 1), null);
    assert.ok(near(viewDir(), [0, 1, 0], 1e-9) && near(up(), [0, 0, -1], 1e-9), `as Top: ${viewDir()} / ${up()}`);
    look([5, 2, 0.3], [0, 1, 0]);                    // near Right, a little from above
    v.lookAtFace(faceOf(p, 'y', 1), null);
    assert.ok(near(viewDir(), [0, 1, 0], 1e-9) && near(up(), [-1, 0, 0], 1e-9), `the least turn from Right: ${viewDir()} / ${up()}`);
  });
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

// ---------------------------------------------------------------------------
// One pick mode at a time, and the scope follows the picks (geometry review).
// ---------------------------------------------------------------------------
test('starting one pick mode ends the others: the next click goes where the last button said', () => {
  withModel([part(plate())], () => {
    run('explodePickStart();');
    v.normalTo();
    assert.equal(run('JSON.stringify([explodePickMode, normalPickMode])'), JSON.stringify([false, true]), 'Normal to… ends Pick parts…');
    run('movePickStart();');
    assert.equal(run('JSON.stringify([normalPickMode, axisPickMode])'), JSON.stringify([false, true]), 'Pick axis… ends Normal to…');
    run('explodePickStart();');
    assert.equal(run('JSON.stringify([axisPickMode, explodePickMode])'), JSON.stringify([false, true]), 'Pick parts… ends Pick axis…');
    run('circlePickMode = true; normalTo();');
    assert.equal(run('JSON.stringify([circlePickMode, explodePickMode, normalPickMode])'), JSON.stringify([false, false, true]), 'and Plane from circle…');
    run('resetExplode();');
    assert.equal(run('normalPickMode'), false, 'a new model ends a pick mode left on');
  });
});
// (the harness's DOM stub shares one element across every id, so Flip's disabled state is checked in t22)
test('taking out the last picked part returns the scope to All', () => {
  const a = part(plate(), [0.1, 0, 0], 'A');
  withModel([a], () => {
    v.explodeToggle(a);
    assert.equal(run('explodeScope'), 'picked');
    v.explodeToggle(a);
    assert.equal(run('explodeScope'), 'all');
  });
});

// ---------------------------------------------------------------------------
// Review findings on PR #12.
// ---------------------------------------------------------------------------
test('flipping the picked axis moves a picked group exploding along it to the other side at once', () => {
  const a = part(plate(), [0.1, 0, 0], 'A');
  withModel([a], () => {
    v.explodeToggle(a);
    run("moveAxis = {p:new THREE.Vector3(), d:new THREE.Vector3(0, 0, 1), part:parts[0], geom:{type:'line'}}; explodeAxis = 'axis';");
    v.setExplode(0.5);
    assert.ok(Math.abs(a.offset.z - 0.05) < 1e-12, `along +Z first, got ${a.offset.toArray()}`);
    run('flipAxis();');
    assert.ok(Math.abs(a.offset.z + 0.05) < 1e-12, `Flip moves it to -Z without another slider move, got ${a.offset.toArray()}`);
    run('moveAxis = null;');
  });
});
test('a pick mode keeps the move handle from taking its click', () => {
  withModel([part(plate())], () => {
    run('__mh = moveHandle; moveHandle = () => ({c:{x:5, y:5}, u:{x:1, y:0}});');   // a handle under the cursor
    try {
      const at = { clientX: 5, clientY: 5 };
      v.ctx.__e = at;
      assert.equal(run('moveGrab(__e)'), true, 'no pick mode: the handle is grabbed');
      for (const m of ['axisPickMode', 'normalPickMode', 'explodePickMode', 'circlePickMode']) {
        run(`${m} = true;`);
        assert.equal(run('moveGrab(__e)'), false, `${m}: the click goes to the pick`);
        run(`${m} = false;`);
      }
    } finally { run('moveHandle = __mh;'); }
  });
});

// ---------------------------------------------------------------------------
// Explode by a typed distance along X / Y / Z, and the reference planes.
// ---------------------------------------------------------------------------
test('Picked parts move by exactly the typed X / Y / Z distances; others stay', () => {
  const a = part(plate(), [0.1, 0, 0], 'A'), b = part(plate(), [-0.05, 0, 0.02], 'B'), c = part(plate(), [0, 0.03, 0], 'C');
  withModel([a, b, c], () => {
    v.explodeToggle(a); v.explodeToggle(b);
    run('setExplodeDist(0, "10"); setExplodeDist(1, "-5"); setExplodeDist(2, "2.5");');   // mm, mesh in metres
    for (const p of [a, b]) assert.ok(near(p.offset.toArray(), [0.01, -0.005, 0.0025], 1e-12), `${p.name} by ${p.offset.toArray()}`);
    assert.ok(near(c.offset.toArray(), [0, 0, 0], 0), `C stays, got ${c.offset.toArray()}`);
    v.setExplode(0.5); run("explodeAxis = 'x'; applyExplode();");      // adds to the % explode
    assert.ok(near(a.offset.toArray(), [0.06, -0.005, 0.0025], 1e-12), `% plus distance, got ${a.offset.toArray()}`);
    run('explodeDist.set(0, 0, 0); setExplode(0);');
    assert.ok(near(a.offset.toArray(), [0, 0, 0], 0), 'cleared: back home');
  });
});
test('scope All: the outermost part centre on each axis moves exactly the typed distance', () => {
  const a = part(plate(), [0.1, 0, 0], 'A'), b = part(plate(), [-0.05, 0, 0.02], 'B'), c = part(plate(), [0, 0.03, -0.04], 'C');
  withModel([a, b, c], () => {
    run('setExplodeDist(0, "20"); setExplodeDist(2, "8");');
    assert.ok(near(a.offset.toArray(), [0.02, 0, 0], 1e-12), `A, farthest on X, by ${a.offset.toArray()}`);
    assert.ok(near(b.offset.toArray(), [-0.01, 0, 0.004], 1e-12), `B halfway on X, +half on Z, by ${b.offset.toArray()}`);
    assert.ok(near(c.offset.toArray(), [0, 0, -0.008], 1e-12), `C, farthest on Z, by ${c.offset.toArray()}`);
    assert.equal(run('exploded()'), true);
    run('explodeDist.set(0, 0, 0); applyExplode();');
  });
});
test('scope All scales to the outermost visible part; nothing off-centre on an axis is said, not silent', () => {
  const a = part(plate(), [0.1, 0, 0], 'A'), b = part(plate(), [-0.05, 0, 0], 'B');
  withModel([a, b], () => {
    a.visible = false;
    run('__toasts = []; __t = toast; toast = m => __toasts.push(m);');
    try {
      run('setExplodeDist(0, "20");');
      assert.ok(near(b.offset.toArray(), [-0.02, 0, 0], 1e-12), `B, outermost visible, moves the full 20 mm: ${b.offset.toArray()}`);
      run('setExplodeDist(2, "5");');
      assert.ok(near(b.offset.toArray(), [-0.02, 0, 0], 1e-12) && run('__toasts.length') === 1, `Z: no part off centre, told once: ${run('JSON.stringify(__toasts)')}`);
    } finally { run('toast = __t; explodeDist.set(0, 0, 0); applyExplode();'); a.visible = true; }
  });
});
test('hiding, showing or isolating parts re-scales a scope-All distance at once', () => {
  const a = part(plate(), [0.1, 0, 0], 'A'), b = part(plate(), [-0.05, 0, 0], 'B'), c = part(plate(), [-0.1, 0, 0], 'C');
  withModel([a, b, c], () => {
    run('parts.forEach(p => p.rowEl = {classList:{toggle(){}, add(){}, remove(){}}});');
    run('setExplodeDist(0, "20");');
    assert.ok(near(b.offset.toArray(), [-0.01, 0, 0], 1e-12), `B halfway: ${b.offset.toArray()}`);
    run('isolate(parts[1]);');                         // only B visible: it is now the outermost
    assert.ok(near(b.offset.toArray(), [-0.02, 0, 0], 1e-12), `isolated B moves the full 20 mm: ${b.offset.toArray()}`);
    run('setPartVisible(parts[0], true);');            // A back: B halfway again, A the full 20 mm
    assert.ok(near(b.offset.toArray(), [-0.01, 0, 0], 1e-12) && near(a.offset.toArray(), [0.02, 0, 0], 1e-12),
      `after showing A: ${a.offset.toArray()} / ${b.offset.toArray()}`);
    run('parts.forEach(p => setPartVisible(p, true)); explodeDist.set(0, 0, 0); applyExplode();');
  });
});
test('a distance that is not a number, or absurdly far, is refused', () => {
  const a = part(plate(), [0.1, 0, 0], 'A');
  withModel([a], () => {
    run('setExplodeDist(0, "abc"); setExplodeDist(1, "1e9");');
    assert.ok(near(run('explodeDist.toArray()'), [0, 0, 0], 0), `kept 0, got ${run('explodeDist.toArray()')}`);
  });
});
test('reference planes: three, through the origin, covering the model and the origin', () => {
  const a = part(plate(), [0.3, 0.2, 0.1], 'A');
  withModel([a], () => {
    run('bboxCached = new THREE.Box3(new THREE.Vector3(0.25, 0.17, 0.095), new THREE.Vector3(0.35, 0.23, 0.105)); setPlanes(true);');
    try {
      assert.equal(run('planeRoot.visible && scene.children.includes(planeRoot)'), true, 'shown, in the scene');
      assert.equal(run('modelRoot.children.includes(planeRoot)'), false, 'not part of the model');
      for (const [name, n] of [['YZ', 0], ['ZX', 1], ['XY', 2]]) {
        const pos = run(`Array.from(planeRoot.children.find(o => o.isMesh && o.userData.plane === '${name}').geometry.attributes.position.array)`);
        const pts = []; for (let i = 0; i < pos.length; i += 3) pts.push(pos.slice(i, i + 3));
        assert.ok(pts.every(p => p[n] === 0), `${name} lies on its plane`);
        for (let k = 0; k < 3; k++) if (k !== n) {
          const lo = Math.min(...pts.map(p => p[k])), hi = Math.max(...pts.map(p => p[k]));
          const bmin = [0.25, 0.17, 0.095][k], bmax = [0.35, 0.23, 0.105][k];
          assert.ok(lo < 0 && hi > bmax && lo <= Math.min(0, bmin), `${name} covers origin and model on axis ${k}: ${lo}..${hi}`);
        }
      }
      run('togglePlanes();');
      assert.equal(run('planeRoot.visible || planesOn'), false, 'P hides all three');
      run('togglePlanes();');
      assert.equal(run('planeRoot.visible'), true, 'and shows them again');
    } finally { run('setPlanes(false); disposePlanes();'); }
  });
});
