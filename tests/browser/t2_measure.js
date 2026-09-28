const L = require('./lib.js');
const {launch, openModel, setCam, click, panel, hideAllBut, world, check} = L;
(async () => {
  const browser = await launch();
  const model = process.argv[2] || 'asm_brep.glb';
  const exact = model.includes('brep');
  const {pg, errors} = await openModel(browser, model);
  await pg.keyboard.press('4');
  check('measure mode on', await pg.evaluate(() => __qs.mode + ' ' + document.getElementById('measurepanel').classList.contains('show')), /measure true/);

  // 1. hole to hole (cylinder / cylinder), plate only
  await hideAllBut(pg, ['plate']);
  const cam = [0.10, -0.12, 0.12];
  await setCam(pg, cam, [-0.005, 0, 0]);
  const far = (cx, cy, r, z) => { const dx = cam[0]-cx, dy = cam[1]-cy, l = Math.hypot(dx, dy); return [cx - r*dx/l, cy - r*dy/l, z]; };
  await click(pg, far(-0.03, 0, 0.005, 0.001));
  check('A = D10 hole', await panel(pg), exact ? /Cylinder \(hole\) Ø10\.00.*diameter Ø10\.00 mm.*radius R5\.000 mm.*length \(mesh\) 10\.000? mm.*source exact/ : /Cylinder \(hole\) Ø10\.00.*fitted to the mesh/);
  await click(pg, far(0.02, 0, 0.008, 0.0));
  const t1 = await panel(pg);
  check('B = D16 hole', t1, /B · Cylinder \(hole\) Ø16\.00/);
  check('hole centre distance 50', t1, /centre distance 50\.00 mm/);
  check('hole gap 37', t1, /gap 37\.00 mm/);
  check('outside to outside 63', t1, /outside to outside 63\.00 mm/);
  check('min distance 37', t1, /min distance \(mesh\) 37\.0\d mm/);
  check('two dims items', JSON.stringify(await pg.evaluate(() => __qs.measItems.map(i => i.type))), /"dim"/);

  // 2. side face x=+50 with D16 hole: third click starts over
  await click(pg, [0.05, -0.01, 0.0]);
  check('3rd click starts a new pair (A = plane)', await panel(pg), /^A · Plane plate \| normal 1\.000, 0\.000, 0\.000/);
  await click(pg, far(0.02, 0, 0.008, -0.002));
  const t2 = await panel(pg);
  check('plane-axis: axis to plane 30', t2, /axis to plane 30\.00 mm/);
  check('plane-axis: min 22', t2, /min to plane 22\.00 mm/);
  check('plane-axis: max 38', t2, /max to plane 38\.00 mm/);

  // 3. edges: chamfer top rim (circle Ø18 on the cone) and the straight top edge at y=+30
  await pg.keyboard.press('Escape');
  check('Esc clears', await panel(pg), /^$/);
  await click(pg, far(0.02, 0, 0.009, 0.005));
  const t3 = await panel(pg);
  check('rim = circle Ø18', t3, exact ? /A · Circle Ø18\.00.*diameter Ø18\.00 mm.*radius R9\.000 mm.*centre 20\.00, 0\.00, 5\.000.*source exact/ : /A · Circle Ø18\.00/);
  await click(pg, [0.0, 0.03, 0.005]);
  const t4 = await panel(pg);
  check('straight edge 90 long', t4, /B · Straight edge 90\.00 mm/);
  check('circle to line: centre to edge 30', t4, /centre to edge 30\.00 mm/);
  check('circle to line: circle to edge 21', t4, /circle to edge 21\.00 mm/);

  // 4. corner fillet arc on the top face (R5 quarter circle), plate corner at (+50,+30)
  await pg.keyboard.press('Escape');
  const c45 = Math.SQRT1_2;
  await click(pg, [0.045 + 0.005*c45, 0.025 + 0.005*c45, 0.005]);
  check('corner arc R5 90°', await panel(pg), exact ? /A · Arc R5\.000.*radius R5\.000 mm.*arc angle 90\.00°.*arc length 7\.854 mm.*source exact/ : /A · Arc R5\.000.*arc angle 90\.00°/);

  // 5. shaft: cylinders, torus, sphere
  await pg.keyboard.press('Escape');
  await hideAllBut(pg, ['shaft']);
  await setCam(pg, [0.06, -0.10, 0.09], [-0.03, 0, 0.035]);
  const s = (x, y, z) => world(pg, 'shaft', [x, y, z]);
  const toward = async (r, z) => { const o = await s(0, 0, z); const dx = 0.06 - o[0], dy = -0.10 - o[1], l = Math.hypot(dx, dy); return [o[0] + r*dx/l, o[1] + r*dy/l, o[2]]; };
  await click(pg, await toward(0.010, 0.015));
  check('D20 boss', await panel(pg), /A · Cylinder \(boss\) Ø20\.00.*length \(mesh\) 30\.00 mm/);
  await pg.keyboard.press('Escape');
  // torus: tube centre at r=8, z=32 (local); point on the tube towards the camera, 45° up the fillet
  { const o = await s(0, 0, 0.032); const dx = 0.06 - o[0], dy = -0.10 - o[1], l = Math.hypot(dx, dy); const rr = 0.008 - 0.002*c45;
    await click(pg, [o[0] + rr*dx/l, o[1] + rr*dy/l, o[2] - 0.002*c45]); }
  check('fillet torus', await panel(pg), exact ? /A · Torus R2\.000.*tube radius R2\.000 mm.*ring radius R8\.000 mm/ : /Freeform surface/);
  await pg.keyboard.press('Escape');
  { const o = await s(0, 0, 0.055); await click(pg, [o[0] + 0.006*0.5, o[1] - 0.006*0.5, o[2] + 0.006*c45]); }
  check('sphere end Ø12', await panel(pg), /A · Sphere Ø12\.00.*diameter Ø12\.00 mm.*centre -30\.00, 0\.00, 60\.00/);
  await click(pg, await toward(0.006, 0.045));
  const t5 = await panel(pg);
  check('sphere + D12 cylinder: centre on axis', t5, /B · Cylinder \(boss\) Ø12\.00.*centre to axis 0 \(on the axis\)/);
  // edge: D20 cylinder top rim (circle between cylinder and shoulder plane at z=30 local)
  await pg.keyboard.press('Escape');
  await click(pg, await toward(0.010, 0.030));
  check('shoulder rim circle Ø20', await panel(pg), /A · Circle Ø20\.00/);

  // 6. bracket inner walls: 20 apart
  await pg.keyboard.press('Escape');
  await hideAllBut(pg, ['bracket']);
  const b = (x, y, z) => world(pg, 'bracket', [x, y, z]);
  await setCam(pg, await b(0.11, 0.0, 0.05), await b(0, 0, 0.0));
  await click(pg, await b(0.0, 0.01, 0.004));
  await click(pg, await b(0.0, -0.01, 0.004));
  const t6 = await panel(pg);
  check('bracket inner walls 20 apart', t6, /distance 20\.00 mm.*planes parallel.*min distance \(mesh\) 20\.00 mm/);

  // 7. cross-part: shaft D20 axis to plate side face x=-50, then explode: values stay assembled
  await pg.keyboard.press('Escape');
  await hideAllBut(pg, ['plate', 'shaft']);
  await setCam(pg, [-0.16, -0.12, 0.09], [-0.03, 0, 0.01]);
  await click(pg, [-0.05, -0.01, 0.0]);
  { const o = await s(0, 0, 0.015); const dx = -0.16 - o[0], dy = -0.12 - o[1], l = Math.hypot(dx, dy); await click(pg, [o[0] + 0.01*dx/l, o[1] + 0.01*dy/l, o[2]]); }
  const t7 = await panel(pg);
  check('shaft axis to plate side 20', t7, /axis to plane 20\.00 mm.*min to plane 10\.00 mm/);
  await pg.click('#btnExplode');
  await pg.$eval('#expAmount', el => { el.value = 60; el.dispatchEvent(new Event('input')); });
  const ex = await pg.evaluate(() => ({amt: __qs.explodeAmt, off: __qs.parts.map(p => p.name + ':' + p.offset.toArray().map(v => (v*1000).toFixed(2)).join(',')),
    txt: document.getElementById('measbody').innerText.replace(/\n+/g, ' | '), label: __qs.annotItems().filter(i => i.type === 'dim').length}));
  console.log('      explode offsets', ex.off.join('  '));
  check('explode moves parts', ex.off.join(' '), /shaft:-?\d+\.\d+,/);
  check('values after explode unchanged + assembled note', await L.panel(pg), /axis to plane 20\.00 mm.*min to plane 10\.00 mm.*assembled positions/);
  // new measurement while exploded: same numbers
  await pg.keyboard.press('Escape');
  await setCam(pg, [-0.20, -0.16, 0.12], [-0.05, 0, 0.03]);
  const off = await pg.evaluate(() => { const o = {}; __qs.parts.forEach(p => o[p.name] = p.offset.toArray()); return o; });
  const add = (p, n) => p.map((v, i) => v + off[n][i]);
  await click(pg, add([-0.05, -0.01, 0.0], 'plate'));
  { const o = await s(0, 0, 0.015); const dx = -0.20 - (o[0] + off.shaft[0]), dy = -0.16 - (o[1] + off.shaft[1]), l = Math.hypot(dx, dy); await click(pg, add([o[0] + 0.01*dx/l, o[1] + 0.01*dy/l, o[2]], 'shaft')); }
  check('measured while exploded = assembled value', await panel(pg), /axis to plane 20\.00 mm.*min to plane 10\.00 mm/);
  await pg.click('#btnExpReset');
  check('reset explode', JSON.stringify(await pg.evaluate(() => __qs.parts.map(p => p.offset.length()))), /^\[0,0,0\]$/);

  console.log('console errors:', errors.filter(e => !/Failed to load resource/.test(e)));
  console.log(L.failures() ? L.failures() + ' FAILURES' : 'ALL PASS');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
