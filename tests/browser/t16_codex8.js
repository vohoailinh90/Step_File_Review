const L = require('./lib.js');
const {launch, openModel, check} = L;
(async () => {
  const browser = await launch();
  const {pg, errors} = await openModel(browser, 'asm_brep.glb', 'asm.step');
  await pg.keyboard.press('4');
  const find = async (name, test) => pg.evaluate(([n, t]) => { const part = __qs.parts.find(p => p.name === n), geo = part.mesh.geometry, topo = __qs.topology(geo);
    const pred = new Function('s', 'return ' + t);
    for (let f = 0; f < topo.fStart.length - 1; f++) if (pred(__qs.faceInfo(geo, f).surf)) return f; return -1; }, [name, test]);
  const pair = async (a, b) => pg.evaluate(([a, b]) => {
    __qs.measureClear(false);
    for (const [n, f] of [a, b]) __qs.addMeasureEntity(__qs.faceEntity(__qs.parts.find(p => p.name === n), f, null));
    const t = __qs.measItems.find(i => i.type === 'tag');
    return {keep:document.getElementById('btnMeasKeep').disabled ? 'disabled' : 'enabled',
            items:__qs.measItems.filter(i => i.type !== 'center' && i.type !== 'edge').map(i => i.type + (i.text ? ':' + i.text : '')).join(','),
            at:t ? [t.a.p.x, t.a.p.y, t.a.p.z].map(v => (v * 1000).toFixed(2)).join(',') : '',
            panel:[...document.getElementById('measbody').children].map(d => [...d.children].map(c => c.textContent.trim()).filter(Boolean).join(' ') || d.textContent.trim()).join(' | ')};
  }, [a, b]);
  // A. flush faces on separate parts: the shaft's bottom stands on the plate's top
  const top = await find('plate', "s.type === 'plane' && Math.abs(s.n.z) > 0.99 && Math.abs(s.p.z - 0.005) < 1e-9");
  const foot = await find('shaft', "s.type === 'plane' && Math.abs(s.n.z) > 0.99 && Math.abs(s.p.z) < 1e-9");
  let r = await pair(['plate', top], ['shaft', foot]);
  console.log('   plate top + shaft foot:', r.keep, '|', r.items, '@', r.at, '|', r.panel);
  check('coplanar touching: headline labelled', r.items, /^tag:0 \(coplanar\)$/);
  check('coplanar touching: Keep enabled', r.keep, /^enabled$/);
  check('label on the contact (z = 5)', r.at, /,5\.00$/);
  const txt = async () => pg.evaluate(() => { const t = [...__qs.measItems, ...__qs.keptItems].find(i => i.type === 'tag'); return __qs.dimText(t); });
  check('assembled: plain text', await txt(), /^0 \(coplanar\)$/);
  await pg.evaluate(() => __qs.setExplode(0.5));
  check('exploded: marked assembled', await txt(), /^0 \(coplanar\) \(assembled\)$/);
  await pg.keyboard.press('k');
  check('K keeps it', await pg.evaluate(() => __qs.keptItems.map(i => i.type + ':' + (i.text || '')).join(',')), /tag:0 \(coplanar\)/);
  check('kept label still marked while exploded', await txt(), /^0 \(coplanar\) \(assembled\)$/);
  await pg.evaluate(() => __qs.setExplode(0));
  check('back together: plain again', await txt(), /^0 \(coplanar\)$/);
  const angleTxt = await pg.evaluate(() => { const T = __qs.THREE, V = (x, y, z) => new T.Vector3(x, y, z), [p1, p2] = __qs.parts;
    const res = __qs.relate({kind:'face', part:p1, geom:{type:'plane', p:V(0, 0, 0), n:V(0, 0, 1)}, exact:true, hit:V(0, 0, 0)},
                            {kind:'face', part:p2, geom:{type:'plane', p:V(0, 0, 0), n:V(1, 0, 0)}, exact:true, hit:V(0.01, 0, 0.01)}, null);
    __qs.setExplode(0.5); const t = __qs.dimText(res.items.find(i => i.type === 'tag')); __qs.setExplode(0); return t; });
  check('an angle between parts needs no marker (explode only translates)', angleTxt, /^90\.00°$/);
  await pg.keyboard.press('Escape'); await pg.keyboard.press('Escape');
  // B. a pair that already draws something is left alone: plate top + bracket wall (angle), D16 hole + D10 hole (dims)
  const h10 = await find('plate', "s.type === 'cylinder' && Math.abs(s.r - 0.005) < 1e-9");
  const h16 = await find('plate', "s.type === 'cylinder' && Math.abs(s.r - 0.008) < 1e-9");
  r = await pair(['plate', h10], ['plate', h16]);
  check('two holes: only their dimension, no extra label', r.items, /^dim$/);
  // C. synthetic line-to-line fit: a R5 pin in a R5 hole, coaxial and touching
  const c = await pg.evaluate(() => {
    const T = __qs.THREE, V = (x, y, z) => new T.Vector3(x, y, z), part = __qs.parts[0];
    const cyl = (hole, hit) => ({kind:'face', part, geom:{type:'cylinder', p:V(0, 0, 0), a:V(0, 0, 1), r:0.005, h0:0, h1:0.01, hole}, exact:true, hit});
    const A = cyl(true, V(0.005, 0, 0.002)), B = cyl(false, V(0, 0.005, 0.004));
    const res = __qs.relate(A, B, {d:0, pa:V(0.005, 0, 0.003), pb:V(0.005, 0, 0.003)});
    return res.rows.map(r => r.join(' ')).join(' | ') + ' || ' + res.items.map(i => i.type + ':' + (i.text || i.value)).join(',');
  });
  console.log('   pin in hole, line to line:', c);
  check('line-to-line fit: headline labelled', c, /\|\| tag:0 \(coaxial\)$/);
  console.log('   errors:', errors.filter(e => !/Failed to load resource/.test(e)));
  console.log(L.failures() ? L.failures() + ' FAILURES' : 'ALL PASS');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
