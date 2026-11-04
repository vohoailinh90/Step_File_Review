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

  // no letter or line may be cut off by the canvas: the outermost ring of pixels stays empty in every view
  const edgePixels = () => pg.evaluate(() => { const c = document.getElementById('axes'), w = c.width, h = c.height;
    const d = c.getContext('2d').getImageData(0, 0, w, h).data; let n = 0;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if ((x === 0 || y === 0 || x === w - 1 || y === h - 1) && d[(y * w + x) * 4 + 3] > 0) n++;
    return n; });
  for (const v of ['front', 'top', 'right', 'iso']){
    await pg.click('[data-view="' + v + '"]'); await settle(); await pg.waitForTimeout(100);
    check('triad not clipped by its canvas in the ' + v + ' view', String(await edgePixels()), /^0$/);
  }
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

  // Shift with Left / Right turns the model about the world Z axis: from the front, the line of sight
  await pg.click('[data-view="front"]'); await settle();
  const shiftArrow = async k => { await pg.keyboard.down('Shift'); await pg.keyboard.press(k); await pg.keyboard.up('Shift'); };
  for (let i = 0; i < 6; i++) await shiftArrow('ArrowRight');
  await settle();
  check('six presses of Shift+Right turn the model 90 deg clockwise about Z: +X at the bottom', JSON.stringify(await cam()), /^\{"at":\[0,0,1\],"up":\[-1,0,0\]\}$/);
  t = await triad();
  check('and the triad still draws all three axes', JSON.stringify([t.n.r > 20, t.n.g > 20, t.n.b > 0]), /^\[true,true,true\]$/);
  for (let i = 0; i < 6; i++) await shiftArrow('ArrowLeft');
  await settle();
  check('six of Shift+Left undo it', JSON.stringify(await cam()), /^\{"at":\[0,0,1\],"up":\[0,1,0\]\}$/);
  await shiftArrow('ArrowUp'); await settle();
  check('Shift+Up does nothing', JSON.stringify(await cam()), /^\{"at":\[0,0,1\],"up":\[0,1,0\]\}$/);

  // The mouse: with Z up the screen, a sideways drag spins the model about Z (it used to roll it about Y)
  const rect = await pg.evaluate(() => { const b = document.getElementById('canvas3d').getBoundingClientRect(); return {x:b.left + b.width / 2, y:b.top + b.height / 2, h:b.height}; });
  const dragRight = async frac => { await pg.mouse.move(rect.x, rect.y); await pg.mouse.down();
    for (let i = 1; i <= 20; i++) await pg.mouse.move(rect.x + rect.h * frac * i / 20, rect.y);
    await pg.mouse.up(); await settle(); };
  await pg.evaluate(() => { const c = __qs.camera, t = __qs.controls.target; c.up.set(0, 0, 1);
    c.position.set(t.x - 5 * __qs.modelSize, t.y, t.z); c.lookAt(t); __qs.controls.update(); });
  await settle();
  check('Z up the screen, camera behind X', JSON.stringify(await cam()), /^\{"at":\[-1,0,0\],"up":\[0,0,1\]\}$/);
  await dragRight(0.25);
  check('a drag right a quarter turn spins about Z: the camera goes round to Y, Z stays up', JSON.stringify(await cam()), /^\{"at":\[0,1,0\],"up":\[0,0,1\]\}$/);
  await pg.click('[data-view="front"]'); await settle();
  await dragRight(0.25);
  check('in the front view a drag right still spins about Y', JSON.stringify(await cam()), /^\{"at":\[-1,0,0\],"up":\[0,1,0\]\}$/);
  await pg.click('[data-view="front"]'); await settle();

  // Looking along Y (Top / Bottom, or straight down after a drag) a sideways drag must still turn the model:
  // its sense used to follow rounding noise and the view swung to and fro instead
  for (const at of [[0, 1, 0.0001], [0, -1, 0.0001]]){
    await pg.evaluate(([at]) => { const c = __qs.camera, t = __qs.controls.target, s = 5 * __qs.modelSize;
      c.up.set(1, 0, 0); c.position.set(t.x + at[0] * s, t.y + at[1] * s, t.z + at[2] * s); c.lookAt(t); __qs.controls.update(); }, [at]);
    await settle();
    const u0 = (await cam()).up;
    await dragRight(0.1);
    const u1 = (await cam()).up, moved = Math.hypot(...u0.map((x, k) => x - u1[k]));
    check('looking along Y (' + at + ') a drag of a tenth of a turn turns the view 36 deg (up moves 0.62)', moved.toFixed(1), /^0\.6$/);
  }
  await pg.click('[data-view="front"]'); await settle();

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
