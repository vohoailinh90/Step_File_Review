const L = require('./lib.js');
const {launch, openModel, check} = L;
// t21: the X / Y / Z triad in the lower-left corner follows the camera, and the arrow keys turn the
// model like a drag (15 degrees a press, the same sense as dragging the cursor that way).
(async () => {
  const browser = await launch();
  const {pg, errors} = await openModel(browser, 'asm_brep.glb', 'asm.step');
  const settle = async () => { await pg.waitForFunction(() => __qs.orbitPending === 0, null, {timeout:10000}); await pg.waitForTimeout(80); };
  const cam = () => pg.evaluate(() => { const o = __qs.camera.position.clone().sub(__qs.controls.target).normalize();
    return {at: o.toArray().map(v => +v.toFixed(2) || 0), up: __qs.camera.up.toArray().map(v => +v.toFixed(2) || 0)}; });
  // the triad: which of red / green / blue pixels it has drawn, and whether it sits in the lower-left corner
  const triad = () => pg.evaluate(() => {
    const c = document.getElementById('axes'), r = c.getBoundingClientRect(), v = document.getElementById('viewport').getBoundingClientRect();
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, n = {r:0, g:0, b:0};
    for (let i = 0; i < d.length; i += 4){ if (d[i+3] < 200) continue;
      if (d[i] > 200 && d[i+1] < 100 && d[i+2] < 100) n.r++; else if (d[i+1] > 150 && d[i] < 100 && d[i+2] < 100) n.g++; else if (d[i+2] > 200 && d[i] < 100 && d[i+1] < 150) n.b++; }
    return {n, left: Math.round(r.left - v.left), bottom: Math.round(v.bottom - r.bottom)};
  });

  await pg.click('[data-view="front"]'); await settle();
  let t = await triad();
  check('triad in the lower-left corner', JSON.stringify([t.left, t.bottom]), /^\[8,8\]$/);
  check('triad draws X red, Y green; Z points at the viewer so it is a dot of blue', JSON.stringify([t.n.r > 20, t.n.g > 20]), /^\[true,true\]$/);
  await pg.click('[data-view="top"]'); await settle(); await pg.waitForTimeout(100);
  t = await triad();
  check('from the top Z lies along the screen and shows blue', t.n.b > 20, /^true$/);

  await pg.click('[data-view="front"]'); await settle();
  for (let i = 0; i < 6; i++) await pg.keyboard.press('ArrowDown');
  await settle();
  check('six presses of Down tip the model 90 deg: looking straight down', JSON.stringify(await cam()), /^\{"at":\[0,1,0\],"up":\[0,0,-1\]\}$/);
  for (let i = 0; i < 6; i++) await pg.keyboard.press('ArrowUp');
  await settle();
  check('six of Up undo it', JSON.stringify(await cam()), /^\{"at":\[0,0,1\],"up":\[0,1,0\]\}$/);
  for (let i = 0; i < 6; i++) await pg.keyboard.press('ArrowRight');
  await settle();
  check('six of Right turn it 90 deg like a drag to the right (as t20)', JSON.stringify(await cam()), /^\{"at":\[-1,0,0\],"up":\[0,1,0\]\}$/);
  for (let i = 0; i < 6; i++) await pg.keyboard.press('ArrowLeft');
  await settle();
  check('six of Left undo it', JSON.stringify(await cam()), /^\{"at":\[0,0,1\],"up":\[0,1,0\]\}$/);

  // fields keep their arrows: a focused slider must not turn the view
  await pg.keyboard.press('v');
  await pg.focus('#expAmount').catch(() => {});
  const before = JSON.stringify(await cam());
  await pg.keyboard.press('ArrowRight'); await settle();
  check('an arrow key in a slider does not turn the model', JSON.stringify(await cam()), new RegExp('^' + before.replace(/[[\]{}.]/g, '\\$&') + '$'));
  const bad = errors.filter(e => /^(error|pageerror)/.test(e) && !/Failed to load resource/.test(e));
  check('no errors in the console', bad.join(' | ') || 'none', /^none$/);
  console.log(L.failures() ? L.failures() + ' FAILURES' : 'ALL PASS');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
