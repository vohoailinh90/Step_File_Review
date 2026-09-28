const L = require('./lib.js');
const {launch, openModel, setCam, hideAllBut, check} = L;
(async () => {
  const browser = await launch();
  const page = process.argv[2] || 'viewer_test.html';
  const {pg, errors} = await openModel(browser, 'asm_brep.glb', 'asm.step', page);
  // A. patches of one cylinder never prove a straight edge; parallel distinct cylinders still do
  const a = await pg.evaluate(() => {
    const T = __qs.THREE, V = (x, y, z) => new T.Vector3(x, y, z), line = [V(0.005, 0, 0), V(0.005, 0, 0.01)];
    const cyl = (p, r) => ({type:'cylinder', p, a:V(0, 0, 1), r, exact:true});
    const cases = {
      'two patches of one cylinder': [cyl(V(0, 0, 0), 0.005), cyl(V(0, 0, 0.02), 0.005)],
      'two parallel cylinders meeting': [cyl(V(0, 0, 0), 0.005), cyl(V(0.008, 0, 0), 0.003)],
    };
    const o = {};
    for (const [k, s] of Object.entries(cases)){ const g = __qs.classifyEdge(line.map(p => p.clone()), false, s); o[k] = g.type + ' exact=' + g.exact; }
    return o;
  });
  console.log('  ', JSON.stringify(a));
  check('patches of one cylinder: not exact', a['two patches of one cylinder'], /^line exact=false$/);
  check('two distinct parallel cylinders: exact', a['two parallel cylinders meeting'], /^line exact=true$/);

  // B. a section through the shaft's axis (Right plane moved to x = -30 mm), caps on
  await pg.evaluate(() => __qs.camera.up.set(0, 0, 1));
  await pg.click('#btnSection');
  await pg.click('[data-sec="right"]');
  await pg.evaluate(() => { const el = document.getElementById('secOffset'), v = (-0.030 - __qs.modelCenter.x) / (__qs.modelSize * 0.6);
    el.value = v; el.dispatchEvent(new Event('input')); });
  const planeX = await pg.evaluate(() => -__qs.sectionPlane.constant / __qs.sectionPlane.normal.x);
  console.log('   section plane at x =', (planeX * 1000).toFixed(3), 'mm; caps', await pg.evaluate(() => !!document.querySelector('#btnCaps.active')));
  await hideAllBut(pg, ['shaft']);
  // look at the cut from the removed side (x < plane), square on
  const px = async (p, name) => pg.evaluate(([p, n]) => {        // colour of the pixel showing world point p (+ the part's offset)
    const T = __qs.THREE, part = __qs.parts.find(q => q.name === n), v = new T.Vector3(...p).add(part.offset).project(__qs.camera);
    const c = __qs.renderer.domElement, x = Math.round((v.x + 1) / 2 * c.width), y = Math.round((1 - v.y) / 2 * c.height);
    const cv = document.createElement('canvas'); cv.width = c.width; cv.height = c.height;
    const g = cv.getContext('2d'); g.drawImage(c, 0, 0); const d = g.getImageData(x, y, 1, 1).data; return [d[0], d[1], d[2]];
  }, [p, name]);
  const look = async () => { const o = await pg.evaluate(() => __qs.parts.find(p => p.name === 'shaft').offset.toArray());
    await setCam(pg, [-0.22 + o[0], o[1] - 0.01, 0.035 + o[2]], [-0.03 + o[0], o[1], 0.035 + o[2]]); await pg.waitForTimeout(150); };
  const inside = [planeX + 0.0002, 0.003, 0.02];                // just past the cut, inside the D20 body
  const shell = [planeX + 0.0002, 0.0099, 0.02];                 // at the wall
  await look();
  const capOn = await px(inside, 'shaft');
  await pg.click('#btnCaps'); await pg.waitForTimeout(150);
  const capOff = await px(inside, 'shaft');
  await pg.click('#btnCaps'); await pg.waitForTimeout(150);
  console.log('   assembled: cut interior with caps', capOn, 'without', capOff);
  const bluish = c => c[2] > c[0] + 6 && c[2] > 40;              // the cap material is 0x6f7885
  check('caps fill the cut when assembled', String(bluish(capOn)), /^true$/);
  check('without caps the cut is hollow', String(bluish(capOff)), /^false$/);
  await pg.screenshot({path:L.OUT + 't14_assembled_' + page.replace('.html', '') + '.png'});

  // C. explode: the shaft moves 36 mm further out along -x; its cut and cap go with it
  await pg.evaluate(() => __qs.setExplode(0.6));
  await look();
  const exp = await pg.evaluate(() => {
    const T = __qs.THREE, sp = __qs.sectionPlane;
    const drift = Math.max(...__qs.parts.map(p => Math.abs(p.clip.distanceToPoint(p.restCenter.clone().add(p.offset)) - sp.distanceToPoint(p.restCenter))));
    const sh = __qs.parts.find(p => p.name === 'shaft'), kept = new T.Vector3(sh.restCenter.x + 0.009, 0, 0.02).add(sh.offset), gone = new T.Vector3(sh.restCenter.x - 0.009, 0, 0.02).add(sh.offset);
    const capAt = sh.capQuad ? sh.clip.distanceToPoint(sh.capQuad.position) : null;
    return {drift, offset:sh.offset.toArray().map(v => (v * 1000).toFixed(2)).join(','), keptShown:__qs.notClipped(kept, sh.mesh), goneShown:__qs.notClipped(gone, sh.mesh),
            worldPlaneWouldShow:sp.distanceToPoint(kept) >= 0, capOnPlane:capAt, capNear:sh.capQuad ? sh.capQuad.position.distanceTo(kept) : null};
  });
  console.log('   exploded:', JSON.stringify(exp));
  check('each part keeps its assembled cut', String(exp.drift < 1e-12), /^true$/);
  check('kept half of the moved shaft still shown', String(exp.keptShown), /^true$/);
  check('removed half of the moved shaft still removed', String(exp.goneShown), /^false$/);
  check('(a world-fixed plane would have removed it all)', String(exp.worldPlaneWouldShow), /^false$/);
  check('shaft cap lies in its moved plane', String(Math.abs(exp.capOnPlane) < 1e-12), /^true$/);
  const capExp = await px(inside, 'shaft');
  console.log('   exploded: cut interior', capExp);
  check('cap drawn at the exploded shaft', String(bluish(capExp)), /^true$/);
  await pg.screenshot({path:L.OUT + 't14_exploded_' + page.replace('.html', '') + '.png'});

  // D. every part together, exploded, from an angle: caps for all three, screenshot for the eye
  await hideAllBut(pg, ['shaft', 'plate', 'bracket']);
  await pg.click('[data-sec="top"]');
  await setCam(pg, [0.12, -0.20, 0.12], [0, 0, 0.02]);
  await pg.waitForTimeout(200);
  await pg.screenshot({path:L.OUT + 't14_all_' + page.replace('.html', '') + '.png'});
  // E. edges built while a section is on are clipped by their part's cut
  const ed = await pg.evaluate(() => { if (!__qs.edgesOn) __qs.toggleEdges(); return __qs.parts.map(p => p.name + ':' + (p.edges && p.edges.material.clippingPlanes && p.edges.material.clippingPlanes[0] === p.clip)).join(' '); });
  check('edges clipped by their part\'s cut', ed, /^plate:true shaft:true bracket:true$/);
  // F. off and back: materials released, caps disposed; reset explode keeps caps aligned
  await pg.click('#btnSecOff');
  const off = await pg.evaluate(() => ({caps:!!__qs.capGroup, clip:__qs.parts.some(p => p.mesh.material.clippingPlanes && p.mesh.material.clippingPlanes.length)}));
  check('section off clears caps and clipping', JSON.stringify(off), /^\{"caps":false,"clip":false\}$/);
  console.log('   errors:', errors.filter(e => !/Failed to load resource/.test(e)));
  console.log(L.failures() ? L.failures() + ' FAILURES' : 'ALL PASS');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
