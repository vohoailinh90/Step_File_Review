const L = require('./lib.js');
const {launch, openModel, check, OUT} = L;
// t23: Explode by typed X / Y / Z distances, through the real panel fields; the reference planes
// through the origin, shown and hidden by the toolbar button and by P.
(async () => {
  const browser = await launch();
  const {pg, errors} = await openModel(browser, 'asm_brep.glb', 'asm.step');
  await pg.click('#canvas3d', {position:{x:5, y:5}});
  const planes = () => pg.evaluate(() => { const r = __qs.scene.children.find(o => o.name === 'reference planes');
    return r ? (r.visible ? 'shown ' : 'hidden ') + r.children.filter(o => o.isMesh).map(o => o.userData.plane).join(',') : 'none'; });
  check('no planes until asked', await planes(), /^none$/);
  await pg.keyboard.press('p'); await pg.waitForTimeout(60);
  check('P shows the three planes', await planes(), /^shown YZ,ZX,XY$/);
  check('each plane carries its label', await pg.evaluate(() => { const r = __qs.scene.children.find(o => o.name === 'reference planes');
    return r.children.filter(o => o.isSprite).map(o => o.userData.plane + ':' + o.userData.label).join(','); }), /^YZ:Left,ZX:Top,XY:Front$/);
  await pg.click('[data-view="iso"]'); await pg.waitForTimeout(150);
  await pg.screenshot({path: OUT + 't23_planes_labels.png'});
  check('the Planes button reads pressed', await pg.evaluate(() => document.getElementById('btnPlanes').getAttribute('aria-pressed')), /^true$/);
  check('the planes are not in the model', await pg.evaluate(() => { let n = 0; __qs.modelRoot.traverse(o => { if (o.userData.plane) n++; }); return n; }), /^0$/);

  await pg.keyboard.press('v'); await pg.waitForTimeout(60);
  const before = await pg.evaluate(() => __qs.parts.map(p => p.restCenter.toArray()));
  // scope All, X 20 mm: the part centre farthest on X moves exactly 20 mm
  await pg.fill('#expDx', '20'); await pg.press('#expDx', 'Enter'); await pg.waitForTimeout(60);
  const r = await pg.evaluate(() => {
    const dx = __qs.parts.map(p => p.restCenter.x - __qs.modelCenter.x), far = Math.max(...dx.map(Math.abs));
    const i = dx.findIndex(v => Math.abs(v) === far), p = __qs.parts[i];
    return [Math.abs(p.offset.x) * 1000, p.offset.y, p.offset.z].map(v => +v.toFixed(6));
  });
  check('All, X 20 mm: the outermost part moves 20 mm on X and nothing else', JSON.stringify(r), /^\[20,0,0\]$/);
  await pg.click('[data-view="iso"]'); await pg.click('#btnFit'); await pg.waitForTimeout(150);
  await pg.screenshot({path: OUT + 't23_dist_planes.png'});
  await pg.click('#btnExpReset'); await pg.waitForTimeout(60);
  check('Reset empties the distance fields', await pg.evaluate(() => ['x','y','z'].map(a => document.getElementById('expD' + a).value).join('|')), /^\|\|$/);
  check('and every part is home', await pg.evaluate(() => __qs.parts.every(p => p.offset.lengthSq() === 0)), /^true$/);

  await pg.click('#btnPlanes'); await pg.waitForTimeout(60);
  check('the button hides all three', await planes(), /^hidden YZ,ZX,XY$/);
  const bad = errors.filter(e => /^(error|pageerror)/.test(e) && !/Failed to load resource/.test(e));   // favicon 404
  check('no errors in the console', bad.join(' | ') || 'none', /^none$/);
  await browser.close();
  process.exit(L.failures() ? 1 : 0);
})();
