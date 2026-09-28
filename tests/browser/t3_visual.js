const L = require('./lib.js');
const fs = require('fs');
const {launch, openModel, setCam, click, panel, hideAllBut, world, check} = L;
const OUT = L.OUT;
(async () => {
  const browser = await launch();
  const {pg, errors} = await openModel(browser, 'asm_brep.glb', 'asm.step');
  await pg.keyboard.press('4');
  const cam = [0.10, -0.12, 0.12];
  await setCam(pg, cam, [-0.005, 0, 0.01]);
  const far = (cx, cy, r, z) => { const dx = cam[0]-cx, dy = cam[1]-cy, l = Math.hypot(dx, dy); return [cx - r*dx/l, cy - r*dy/l, z]; };
  await hideAllBut(pg, ['plate', 'shaft']);
  // single pick: D16 hole -> diameter dimension + centre line
  await click(pg, far(0.02, 0, 0.008, 0.0));
  await pg.screenshot({path: OUT + '1_single_hole.png'});
  // keep it, then measure hole-to-hole
  await pg.keyboard.press('k');
  check('kept', JSON.stringify(await pg.evaluate(() => __qs.keptItems.map(i => i.type))), /center.*dim|dim.*center/);
  await click(pg, far(-0.03, 0, 0.005, 0.001));
  // D10 hole is under the shaft? it is visible from the side through the plate top: shaft sits on it, so pick the corner arc instead
  await pg.keyboard.press('Escape');
  await click(pg, [0.05, -0.01, 0.0]);               // side face x=+50
  await click(pg, far(0.02, 0, 0.008, -0.002));      // D16 hole
  await pg.screenshot({path: OUT + '2_plane_to_hole_plus_kept.png'});
  // screenshot button -> PNG with annotations burnt in
  const [dl] = await Promise.all([pg.waitForEvent('download'), pg.keyboard.press('s')]);
  await dl.saveAs(OUT + '3_downloaded.png');
  console.log('download', dl.suggestedFilename(), fs.statSync(OUT + '3_downloaded.png').size, 'bytes');
  // white background version
  await pg.keyboard.press('b');
  await pg.screenshot({path: OUT + '4_white_bg.png'});
  await pg.keyboard.press('b');
  // face mode: cylinder info
  await pg.keyboard.press('2');
  check('leaving measure mode clears', JSON.stringify(await pg.evaluate(() => [__qs.measA, __qs.keptItems.length, document.getElementById('measurepanel').classList.contains('show')])), /^\[null,0,false\]$/);
  await click(pg, far(0.02, 0, 0.008, 0.0));
  const info = await pg.evaluate(() => document.getElementById('info').innerText.replace(/\n+/g, ' | '));
  check('face mode shows cylinder diameter', info, /FACE.*type cylinder \(hole\).*diameter Ø16\.00 mm.*radius R8\.000 mm.*Exact B-rep face/);
  await pg.screenshot({path: OUT + '5_face_mode.png'});
  // explode + edges + section + caps
  await hideAllBut(pg, ['plate', 'shaft', 'bracket']);
  await pg.keyboard.press('1');
  await pg.evaluate(() => { if (!__qs.edgesOn) __qs.toggleEdges(); });
  await pg.click('#btnSection'); await pg.click('[data-sec="front"]');
  await pg.click('#btnExplode');
  await pg.$eval('#expAmount', el => { el.value = 50; el.dispatchEvent(new Event('input')); });
  await pg.keyboard.press('f');
  await pg.waitForTimeout(150);
  await pg.screenshot({path: OUT + '6_explode_section_edges.png'});
  // per part, in model units (m): edges and both stencil caps sit on the mesh, the cap quad in the part's own cut plane
  const sync = await pg.evaluate(() => __qs.parts.map(p => {
    const T = __qs.THREE, m = new T.Vector3().setFromMatrixPosition(p.mesh.matrixWorld);
    const off = o => o ? new T.Vector3().setFromMatrixPosition(o.matrixWorld).distanceTo(m) : null;
    return {name: p.name, edges: off(p.edges), capBack: off(p.capBack), capFront: off(p.capFront),
            quadOnPlane: p.capQuad && p.clip ? Math.abs(p.clip.distanceToPoint(p.capQuad.position)) : null};
  }));
  console.log('      sync (m):', JSON.stringify(sync));
  const TOL = 1e-9;                                  // 1e-6 mm
  const bad = sync.flatMap(r => ['edges', 'capBack', 'capFront', 'quadOnPlane'].filter(k => !(r[k] !== null && r[k] < TOL)).map(k => r.name + '.' + k + '=' + r[k]));
  check('edges and caps follow parts (3 parts, every entry present, < 1e-6 mm)', sync.length === 3 && !bad.length ? 'ok' : bad.join(', ') || sync.length + ' parts', /^ok$/);
  // Along Z only
  await pg.click('[data-exp="z"]');
  const offz = await pg.evaluate(() => __qs.parts.map(p => p.offset.toArray().map(v => +(v*1000).toFixed(2))));
  check('Z-only explode has no x/y motion', JSON.stringify(offz), /^\[\[0,0,-?\d+(\.\d+)?\],\[0,0,-?\d+(\.\d+)?\],\[0,0,-?\d+(\.\d+)?\]\]$/);
  await pg.keyboard.press('f');
  await pg.waitForTimeout(150);
  await pg.screenshot({path: OUT + '7_explode_z.png'});
  console.log('console errors:', errors.filter(e => !/Failed to load resource/.test(e)));
  console.log(L.failures() ? L.failures() + ' FAILURES' : 'ALL PASS');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
