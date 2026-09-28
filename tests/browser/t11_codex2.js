const L = require('./lib.js');
const {launch, openModel, setCam, click, panel, hideAllBut, check} = L;
(async () => {
  const browser = await launch();
  const {pg, errors} = await openModel(browser, 'asm_brep.glb', 'asm.step');
  await pg.evaluate(() => __qs.camera.up.set(0, 0, 1));
  await pg.keyboard.press('4');
  // area is labelled as mesh-derived even on an exact face
  await hideAllBut(pg, ['plate']);
  const cam = [0.10, -0.12, 0.12];
  await setCam(pg, cam, [-0.005, 0, 0]);
  const far = (cx, cy, r, z) => { const dx = cam[0]-cx, dy = cam[1]-cy, l = Math.hypot(dx, dy); return [cx - r*dx/l, cy - r*dy/l, z]; };
  await click(pg, far(0.02, 0, 0.008, 0.0));
  check('area labelled (mesh) next to an exact source', await panel(pg), /area \(mesh\) 451\.\d+ mm².*source exact \(STEP B-rep\)/);
  // in-plane circle and edge: unchanged numbers (foot inside the edge)
  await pg.keyboard.press('Escape');
  await click(pg, far(0.02, 0, 0.009, 0.005));
  await click(pg, [0.0, 0.03, 0.005]);
  check('in-plane rim to top edge unchanged', await panel(pg), /centre to edge 30\.00 mm \| circle to edge 21\.00 mm/);
  // circle above the plate, vertical tangent edge at the (45, 30) corner: the foot lies past the edge's top end
  await pg.keyboard.press('Escape');
  await hideAllBut(pg, ['plate', 'shaft']);
  await setCam(pg, [0.16, -0.10, 0.12], [0.0, 0.0, 0.02]);
  const o = await pg.evaluate(() => { const v = new __qs.THREE.Vector3(0, 0, 0.030).applyMatrix4(__qs.parts.find(p => p.name === 'shaft').restMatrix); return v.toArray(); });
  const dx = 0.16 - o[0], dy = -0.10 - o[1], l = Math.hypot(dx, dy);
  await click(pg, [o[0] + 0.01*dx/l, o[1] + 0.01*dy/l, o[2]]);        // shoulder rim, Ø20 at z = 35
  const a = await panel(pg);
  check('A = shoulder rim circle', a, /A · Circle Ø20\.00/);
  await click(pg, [0.045, 0.03, -0.001]);                               // tangent line x=45, y=30, z -5..5
  const t = await panel(pg);
  console.log('      ', t);
  check('B = vertical straight edge, 10 long', t, /B · Straight edge (10\.00|10\.000|9\.99\d) mm/);
  // expected: centre to the nearer end of the picked segment, and it must differ from the infinite-line distance
  const exp = await pg.evaluate(() => { const A = __qs.measA.geom, B = __qs.measB.geom, T = __qs.THREE;
    const tt = Math.min(Math.max(new T.Vector3().subVectors(A.c, B.p0).dot(B.d), 0), B.len);
    const seg = A.c.distanceTo(B.p0.clone().addScaledVector(B.d, tt));
    const w = new T.Vector3().subVectors(A.c, B.p0), line = w.clone().addScaledVector(B.d, -w.dot(B.d)).length();
    return {seg:(seg*1000).toFixed(2), line:(line*1000).toFixed(2), clamped: tt === 0 || tt === B.len,
            ends:[B.p0, B.p1].map(p => p.toArray().map(v => (v*1000).toFixed(0)).join(',')).join(' → ')}; });
  console.log('       picked edge', exp.ends, '| to segment', exp.seg, '| to infinite line', exp.line, '| foot clamped', exp.clamped);
  check('foot falls outside the edge (test is meaningful)', String(exp.clamped && exp.seg !== exp.line), /^true$/);
  check('centre to the edge end, not its extension', t, new RegExp('centre to edge ' + exp.seg.replace('.', '\\.') + ' mm'));
  check('no circle-to-edge for an edge out of the circle plane', t, /^(?!.*circle to edge)/);
  console.log('  errors:', errors.filter(e => !/Failed to load resource/.test(e)));
  console.log(L.failures() ? L.failures() + ' FAILURES' : 'ALL PASS');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
