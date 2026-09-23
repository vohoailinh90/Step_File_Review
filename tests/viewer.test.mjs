/**
 * Unit tests for the viewer behaviour that geometry.test.mjs does not reach:
 * unit scaling (src/app/00-scene.js) and the face flood-fill
 * (src/app/30-select.js).
 *
 *   node --test tests/viewer.test.mjs
 *
 * Both modules were previously uncovered, which meant two silent 1000x-class
 * defects passed the whole suite: changing `unitScale` from 1000 to 1, and
 * widening the face break angle from 20 deg to 85 deg. Mutations for both now
 * live in tests/mutation_check.py; these are the tests that catch them.
 *
 * Modules load in filename order via tests/harness.mjs, matching build.py.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runInContext } from 'node:vm';
import { loadViewer, geometryFromTriangles, PAGE } from './harness.mjs';

// ---------------------------------------------------------------------------
// Unit scaling. OpenCASCADE writes glTF in METRES whatever the STEP authored,
// so the viewer reports mesh units x 1000. Every length and area an engineer
// reads passes through L() or A2(); a wrong scale here is a 1000x or 1e6x error
// that still looks like a plausible number.
// ---------------------------------------------------------------------------
const scene = loadViewer(
  ['src/app/00-scene.js', 'src/app/40-geometry.js'],
  ['unitScale', 'L', 'A2', 'fmt'],
);

test('unitScale defaults to 1000 (glTF metres -> mm)', () => {
  assert.equal(scene.unitScale, 1000,
    'GLB/glTF from OpenCASCADE is in metres; the viewer reports mm');
});

test('L() converts mesh units to millimetres', () => {
  assert.equal(scene.L(0.0127), '12.70', 'a 1/2 inch bore is 12.70 mm');
  assert.equal(scene.L(1), '1000', '1 mesh unit is 1000 mm');
  assert.equal(scene.L(0.1), '100.00');
});

test('A2() scales area by unitScale SQUARED, not by unitScale', () => {
  // The classic error: reusing the length scale for an area, giving mm² values
  // 1000x too small. 1e-6 m² is exactly 1 mm².
  assert.equal(scene.A2(1e-6), '1.000', '1e-6 mesh-units² is 1.000 mm²');
  assert.notEqual(scene.A2(1e-6), scene.L(1e-6), 'area must not use the length scale');
  assert.equal(scene.A2(1), '1000000', '1 mesh-unit² is 1e6 mm²');
});

test('L() and A2() agree with fmt() on the scaled value', () => {
  for (const v of [0.001, 0.0127, 0.5, 3, 1234]) {
    assert.equal(scene.L(v), scene.fmt(v * 1000));
    assert.equal(scene.A2(v), scene.fmt(v * 1e6));
  }
});

// ---------------------------------------------------------------------------
// Face flood-fill. selectFace() grows a face outward from the picked triangle,
// stopping at any break sharper than 20 deg. It reports through showInfo(), so
// the tests intercept that to read the triangle count and planar/curved verdict.
// ---------------------------------------------------------------------------
const sel = loadViewer(
  ['src/app/00-scene.js', 'src/app/30-select.js', 'src/app/40-geometry.js'],
  ['selectFace', 'triAdjacency', 'triNormal'],
);
// showInfo is a function declaration, so it is a reassignable global binding.
runInContext('showInfo = d => { __info = d; };  var __info = null;', sel.ctx);

/** Two triangles sharing the edge (0,0,0)-(1,0,0), second rotated by deg about X. */
function hingedPair(deg) {
  const t = deg * Math.PI / 180;
  return geometryFromTriangles([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    0, 0, 0, 1, 0, 0, 0, Math.cos(t), Math.sin(t),
  ]);
}

/** Run selectFace on triangle 0 and read back what it reported. */
function growFace(geo) {
  const part = { mesh: { geometry: geo, matrixWorld: {} }, name: 'test-part' };
  sel.selectFace(part, 0);
  const info = runInContext('__info', sel.ctx);
  assert.ok(info, 'selectFace should have reported through showInfo');
  const rows = Object.fromEntries(info.rows);
  return { tris: Number(rows.triangles.replace(/,/g, '')), type: rows.type, area: rows.area };
}

/** Adjacency arrays are built inside the vm realm, so copy them into host
 *  arrays before comparing -- deepEqual is prototype-sensitive across realms. */
const adjacency = geo => [...sel.triAdjacency(geo)].map(a => [...a]);

test('triAdjacency finds the shared edge between two triangles', () => {
  assert.deepEqual(adjacency(hingedPair(10)), [[1], [0]]);
});

test('triAdjacency reports no neighbour for disjoint triangles', () => {
  const geo = geometryFromTriangles([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    9, 9, 9, 10, 9, 9, 9, 10, 9,
  ]);
  assert.deepEqual(adjacency(geo), [[], []]);
});

test('triNormal returns a unit normal', () => {
  const geo = hingedPair(0);
  const { Vector3 } = sel.THREE;
  const out = sel.triNormal(geo, 0, new Vector3(), new Vector3(), new Vector3(), new Vector3());
  assert.ok(Math.abs(out.length() - 1) < 1e-9, 'normal must be unit length');
  assert.ok(Math.abs(Math.abs(out.z) - 1) < 1e-9, 'a triangle in the XY plane has a Z normal');
});

test('a face grows across a break softer than 20 degrees', () => {
  for (const deg of [0, 5, 10, 15, 19]) {
    assert.equal(growFace(hingedPair(deg)).tris, 2,
      `${deg} deg is softer than the 20 deg break and must merge`);
  }
});

test('a face STOPS at a break sharper than 20 degrees', () => {
  // This is the assertion that was missing. Widening the constant to 85 deg --
  // which merges a chamfer into its neighbouring wall and inflates every
  // reported face area -- previously passed the entire suite.
  for (const deg of [21, 30, 45, 60, 89]) {
    assert.equal(growFace(hingedPair(deg)).tris, 1,
      `${deg} deg is sharper than the 20 deg break and must stop`);
  }
});

test('the break threshold sits between 19 and 21 degrees', () => {
  assert.equal(growFace(hingedPair(19)).tris, 2, '19 deg merges');
  assert.equal(growFace(hingedPair(21)).tris, 1, '21 deg stops');
});

test('coplanar triangles report planar, a soft break reports curved', () => {
  assert.equal(growFace(hingedPair(0)).type, 'planar');
  assert.equal(growFace(hingedPair(10)).type, 'curved',
    'a 10 deg fold is within the break angle but is not flat');
});

test('a coplanar pair reports the summed area in mm2', () => {
  // Two right triangles with legs 1 x 1 in mesh units = 1.0 unit², and
  // 1 unit² is 1e6 mm². Confirms selectFace routes area through A2(), not L().
  const geo = geometryFromTriangles([
    0, 0, 0, 1, 0, 0, 0, 1, 0,
    1, 1, 0, 1, 0, 0, 0, 1, 0,
  ]);
  const got = growFace(geo);
  assert.equal(got.tris, 2, 'the two halves of a unit square are one face');
  assert.equal(got.area, '1000000 mm²');
});

test('an anti-parallel fold still merges, by documented design', () => {
  // selectFace compares |n . n'|, so a surface folded back on itself (180 deg)
  // reads as continuous. That is deliberate -- it keeps a thin wall's two sides
  // together -- but it is a real limit worth pinning so a change is noticed.
  assert.equal(growFace(hingedPair(180)).tris, 2,
    'the abs() in the normal comparison makes 180 deg continuous');
});

// ---------------------------------------------------------------------------
// The runtime half of the air-gap (src/app/10-load.js). A URL that only exists
// at runtime -- a ?model= query, a buffer or image uri inside a .gltf -- cannot
// be judged by tests/check_invariants.py, so every such route goes through
// sameOrigin(). Codex review round 9 on PR #1: ?model=https://... fetched off
// the machine, and so did a .gltf's buffer uri.
// ---------------------------------------------------------------------------
const io = loadViewer(['src/app/10-load.js'], ['sameOrigin']);

test('sameOrigin passes the page\'s own origin, data: and blob:', () => {
  const origin = new URL(PAGE).origin;
  for (const u of ['/model.glb', 'model.glb', 'geo.bin', './a/b.bin', origin + '/x.glb',
                   'data:application/octet-stream;base64,AAAA', 'blob:' + origin + '/1234']) {
    assert.doesNotThrow(() => io.sameOrigin(u), u);
  }
});

test('sameOrigin refuses every other host, however it is spelled', () => {
  for (const u of ['https://example.com/x.glb', 'http://127.0.0.1:9999/x.glb', '//intranet/x.glb',
                   '\\\\intranet\\x.glb', '/\\intranet/x.glb', 'https:example.com/x', ' //intranet/x',
                   'ws://127.0.0.1:8000/x', 'file://server/share/x.bin']) {
    assert.throws(() => io.sameOrigin(u), /blocked a request to another host/, u);
  }
});

test('a hostless file: path is local, so a viewer opened from disk still loads', () => {
  assert.doesNotThrow(() => io.sameOrigin('file:///C:/models/part.glb'));
});

test('every three.js loader URL is routed through sameOrigin', () => {
  const hook = io.THREE.DefaultLoadingManager.urlModifier;
  assert.equal(hook, io.sameOrigin, 'DefaultLoadingManager has no sameOrigin URL hook');
  assert.throws(() => hook('https://example.com/geo.bin'), /another host/);
});

// ---------------------------------------------------------------------------
// The info panel (src/app/40-geometry.js). A part name comes from the model
// file. Codex review round 11 on PR #1 led to a .gltf whose part was named
// <style>@import'\\68ttps...'</style>: showInfo() joined it into innerHTML, and
// clicking the part fetched off the machine. Text from a model must arrive as
// text -- every value goes in through textContent, and nothing is parsed.
// ---------------------------------------------------------------------------
const panel = loadViewer(['src/app/00-scene.js', 'src/app/40-geometry.js'], ['showInfo']);

function texts(node) {
  return [typeof node === 'string' ? node : node.textContent || '',
          ...((node && node.children) || []).flatMap(texts)];
}

test('showInfo puts a model-supplied name in as text, never as markup', () => {
  const hostile = "<style>@import'\\68ttps\\3a\\2f\\2fexample'</style><img src=https://example.com/x>";
  const el = runInContext("$('info')", panel.ctx);
  el.innerHTML = 'UNTOUCHED';
  panel.showInfo({ title: 'PART', rows: [['name', hostile]], foot: 'foot' });
  assert.equal(el.innerHTML, 'UNTOUCHED', 'showInfo wrote markup through innerHTML');
  assert.ok(texts(el).includes(hostile), 'the name should be present, verbatim, as text');
});
