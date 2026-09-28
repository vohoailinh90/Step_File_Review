const L = require('./lib.js');
const {launch, openModel, setCam, click, panel, hideAllBut, check} = L;
(async () => {
  const browser = await launch();
  const {pg, errors} = await openModel(browser, 'asm_brep.glb', 'asm.step');
  await hideAllBut(pg, ['plate']);
  const cam = [0.10, -0.12, 0.12];
  await setCam(pg, cam, [-0.005, 0, 0]);
  const far = (cx, cy, r, z) => { const dx = cam[0]-cx, dy = cam[1]-cy, l = Math.hypot(dx, dy); return [cx - r*dx/l, cy - r*dy/l, z]; };
  await pg.keyboard.press('m');
  // 1. same face twice
  await click(pg, [0.0, 0.02, 0.005]); await click(pg, [0.01, 0.02, 0.005]);
  const t = await pg.evaluate(() => [document.getElementById('toast').textContent, !!__qs.measB]);
  check('same face twice is refused', JSON.stringify(t), /Already picked.*false/);
  // 2. section: cut away x > 0 half; a click on the D16 hole wall region hits nothing kept -> clears
  await pg.keyboard.press('Escape');
  await pg.click('#btnSection'); await pg.click('[data-sec="right"]');
  const kept = await pg.evaluate(() => { const p = new __qs.THREE.Vector3(0.03, 0, 0); return 'x>0 kept: ' + (__qs.scene && true); });
  await click(pg, far(-0.03, 0, 0.005, 0.001));
  const sec = await pg.evaluate(() => __qs.measA ? __qs.measA.part.name + ' ' + __qs.measA.geom.type + ' ' + __qs.measA.hit.x.toFixed(4) : 'none');
  console.log('      with a right-plane cut (keeps x>=0), pick at the D10 hole (x=-30) ->', sec);
  check('pick respects the section cut', sec, /^none$|^plate \w+ 0\.0[0-9]+$/);
  await pg.click('#btnSecOff');
  // 3. units toggle updates dimension labels
  await pg.keyboard.press('Escape'); await pg.keyboard.press('Escape');
  await click(pg, far(0.02, 0, 0.008, 0.0));
  const lab1 = await pg.evaluate(() => __qs.annotItems().filter(i => i.type === 'dim').length);
  await pg.click('#unitToggle');
  const raw = await pg.evaluate(() => document.getElementById('measbody').textContent);
  await pg.click('#unitToggle');
  check('raw units show in panel', raw, /Ø0\.0160/);
  // 4. Edge mode highlight follows explode
  await pg.keyboard.press('3');
  await click(pg, far(0.02, 0, 0.009, 0.005));
  await pg.evaluate(() => __qs.setExplode(0.5));
  const f = await pg.evaluate(() => { const o = [...__qs.scene.children].find(c => c.isLine && c.userData.follow); return o ? o.position.toArray().map(v => +(v*1000).toFixed(2)) + ' vs part ' + o.userData.follow.part.offset.toArray().map(v => +(v*1000).toFixed(2)) : 'no overlay'; });
  check('edge overlay follows explode', f, /^(-?[\d.]+),(-?[\d.]+),(-?[\d.]+) vs part \1,\2,\3$/);
  await pg.evaluate(() => __qs.setExplode(0));
  // 5. load another model while measuring with kept dims: everything resets
  await pg.keyboard.press('4');
  await click(pg, far(0.02, 0, 0.008, 0.0)); await pg.keyboard.press('k');
  const buf = require('fs').readFileSync(L.MODELS + 'plate.stl');
  await pg.setInputFiles('#fileinput', {name:'plate.stl', mimeType:'application/octet-stream', buffer:buf});
  await pg.waitForFunction(() => document.getElementById('fname').textContent === 'plate.stl');
  const after = await pg.evaluate(() => [__qs.measA, __qs.keptItems.length, __qs.annotItems().length, __qs.explodeAmt, __qs.mode]);
  check('new model clears measurements', JSON.stringify(after), /^\[null,0,0,0,"measure"\]$/);
  // 6. face mode on STL: angle-grown face foot
  await pg.keyboard.press('2');
  await setCam(pg, [100, -120, 120], [-5, 0, 0]);
  await click(pg, [0, 20, 5]);
  check('STL face mode foot', await pg.evaluate(() => document.getElementById('info').innerText.replace(/\n+/g, ' | ')), /type plane.*20° break angle/);
  console.log('console errors:', errors.filter(e => !/Failed to load resource/.test(e)));
  console.log(L.failures() ? L.failures() + ' FAILURES' : 'ALL PASS');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
