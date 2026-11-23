const L = require('./lib.js');
const {launch, openModel, check, OUT} = L;
// t24: the plane through a cylinder's axis, turned by an angle from Top, through the real panel; Look
// and Keep; Normal to clicking a plane sheet -- a plane made here and a reference plane that is shown.
(async () => {
  const browser = await launch();
  const {pg, errors} = await openModel(browser, 'asm_brep.glb', 'asm.step');
  const box = await pg.locator('#canvas3d').boundingBox();
  const cam = () => pg.evaluate(() => __qs.camera.position.clone().sub(__qs.controls.target).normalize().toArray().map(v => +v.toFixed(3) || 0));
  const toast = () => pg.evaluate(() => document.getElementById('toast').textContent);
  const nodes = () => pg.evaluate(() => __qs.scene.children.filter(o => /^datum plane/.test(o.name)).map(o => [o.name, o.children.find(c => c.isMesh).userData.normal.toArray().map(v => +v.toFixed(3) || 0)]));
  const shown = () => pg.evaluate(() => document.getElementById('datumpanel').classList.contains('show'));
  const plateAt = p => L.click(pg, p.map(v => v / 1000));   // mm -> mesh units

  await pg.click('#canvas3d', {position:{x:5, y:5}});
  await pg.keyboard.press('d'); await pg.waitForTimeout(60);
  check('D opens the plane panel', String(await shown()), /^true$/);
  check('and the button reads pressed', await pg.evaluate(() => document.getElementById('btnDatum').getAttribute('aria-pressed')), /^true$/);
  check('nothing drawn yet', JSON.stringify(await nodes()), /^\[\]$/);

  // the shaft, a cylinder with its axis along Z at (-30, 0): click its side facing the camera in the iso view,
  // at the radii its steps could have
  await pg.click('[data-view="iso"]'); await pg.waitForTimeout(100);
  await pg.click('#btnDatumAxis'); await pg.waitForTimeout(40);
  check('Pick… waits for the click', await pg.evaluate(() => document.getElementById('btnDatumAxis').classList.contains('active')), /^true$/);
  for (const [r, z] of [[10, 20], [10, 40], [8, 30], [5, 60], [6, 15]]) {
    await plateAt([-30 + r * 0.781, r * 0.625, z]);
    if (!(await pg.evaluate(() => document.getElementById('datumAxisName').classList.contains('none')))) break;
  }
  const axis = await pg.evaluate(() => document.getElementById('datumAxisName').textContent);
  check('the shaft gives its axis, + along Z', axis, /^cylinder Ø\d+(\.\d+)? mm, \+ along \+Z$/);
  check('Look waits for a reference', await pg.evaluate(() => document.getElementById('datumHint').textContent), /Choose what the angle is measured from/);
  await pg.click('[data-dref="Top"]'); await pg.waitForTimeout(60);
  await pg.fill('#datumAngle', '30'); await pg.press('#datumAngle', 'Enter'); await pg.waitForTimeout(80);
  const made = await nodes();
  check('the plane is drawn at 30 deg from Top: normal (-0.5, 0.866, 0)', JSON.stringify(made), /^\[\["datum plane Plane",\[-0\.5,0\.866,0\]\]\]$/);
  await pg.screenshot({path: OUT + 't24_datum_30.png'});

  await pg.click('#btnDatumLook'); await pg.waitForTimeout(120);
  const c = await cam();
  check('Look: square to the plane', String(Math.abs(c[0] * -0.5 + c[1] * 0.866).toFixed(3)), /^1\.000$/);
  check('and the axis stands upright', await pg.evaluate(() => __qs.camera.up.toArray().map(v => +v.toFixed(3) || 0).join()), /^0,0,1$/);
  await pg.screenshot({path: OUT + 't24_datum_look.png'});

  await pg.click('#btnDatumKeep'); await pg.waitForTimeout(60);
  check('Keep names it P1, and it is drawn once', JSON.stringify((await nodes()).map(n => n[0])), /^\["datum plane P1"\]$/);
  await pg.fill('#datumAngle', '75'); await pg.press('#datumAngle', 'Enter'); await pg.waitForTimeout(60);
  check('a new angle draws a second plane beside P1', JSON.stringify((await nodes()).map(n => n[0])), /^\["datum plane P1","datum plane Plane"\]$/);
  await pg.fill('#datumAngle', '30'); await pg.press('#datumAngle', 'Enter'); await pg.waitForTimeout(60);

  // Normal to, clicking P1: from the iso view, a point on it well above the model
  await pg.click('[data-view="iso"]'); await pg.waitForTimeout(100);
  await pg.click('#btnNormal');
  await pg.evaluate(() => { const o = __qs.scene.children.find(o => o.name === 'datum plane P1'), s = o.children.find(c => c.isMesh);
    const g = s.geometry.attributes.position, a = new __qs.THREE.Vector3(), b = new __qs.THREE.Vector3(), m = new __qs.THREE.Vector3();
    a.fromBufferAttribute(g, 0); b.fromBufferAttribute(g, 2); m.copy(a).lerp(b, 0.5);                // the sheet's centre
    m.lerp(new __qs.THREE.Vector3().fromBufferAttribute(g, 4), 0.55);                                  // towards a top corner
    window.__pt = m.toArray(); });
  const pt = await pg.evaluate(() => __pt);
  await L.click(pg, pt);
  check('Normal to a plane that was made: it looks square at it', String(Math.abs((await cam()).reduce((s, v, i) => s + v * [-0.5, 0.866, 0][i], 0)).toFixed(3)), /^1\.000$/);
  check('and says which', await toast(), /Normal to P1/);

  // a reference plane that is shown: Top (ZX), a point of it clear of the parts
  await pg.keyboard.press('p'); await pg.waitForTimeout(60);
  await pg.click('[data-view="iso"]'); await pg.waitForTimeout(100);
  await pg.click('#btnNormal');
  await L.click(pg, [0.055, 0, 0.05]);
  check('Normal to a shown reference plane: Top is looked at from above', JSON.stringify(await cam()), /^\[0,1,0\]$/);
  check('and says Top', await toast(), /Top plane \(ZX\)/);
  await pg.screenshot({path: OUT + 't24_normal_top.png'});

  await pg.click('#btnDatumClear'); await pg.waitForTimeout(60);
  check('Clear takes the planes away', JSON.stringify(await nodes()), /^\[\]$/);
  await pg.keyboard.press('d'); await pg.waitForTimeout(40);
  check('D closes the panel', String(await shown()), /^false$/);
  const bad = errors.filter(e => /^(error|pageerror)/.test(e) && !/Failed to load resource/.test(e));
  check('no errors in the console', bad.join(' | ') || 'none', /^none$/);
  await browser.close();
  process.exit(L.failures() ? 1 : 0);
})();
