const L = require('./lib.js');
const {launch, openModel, check} = L;
// t20: turning the view has no end stop (a drag used to stop dead once the view looked straight
// down), and Explode → Pick… moves a part along an edge, a circle, a cylinder axis or a face normal:
// by a typed distance, or by dragging the arrow drawn on it. Real mouse input throughout.
(async () => {
  const browser = await launch();
  const {pg, errors} = await openModel(browser, 'asm_brep.glb', 'asm.step');
  const rect = await pg.evaluate(() => { const b = document.getElementById('canvas3d').getBoundingClientRect(); return {x:b.left, y:b.top, w:b.width, h:b.height}; });
  const cx = rect.x + rect.w / 2, cy = rect.y + rect.h / 2;
  const settle = async () => { await pg.waitForFunction(() => __qs.orbitPending === 0, null, {timeout:10000}); await pg.waitForTimeout(50); };
  const drag = async (dx, dy, steps = 30) => {
    await pg.mouse.move(cx, cy); await pg.mouse.down();
    for (let i = 1; i <= steps; i++) await pg.mouse.move(cx + dx * i / steps, cy + dy * i / steps);
    await pg.mouse.up(); await settle();
  };
  // the camera relative to its target, as a unit vector, and its up; to 2 decimals (half a pixel of drag is 0.2 deg)
  const cam = () => pg.evaluate(() => { const o = __qs.camera.position.clone().sub(__qs.controls.target).normalize();
    return {at: o.toArray().map(v => +v.toFixed(2) || 0), up: __qs.camera.up.toArray().map(v => +v.toFixed(2) || 0)}; });

  // A. Turning. From the front, half a canvas height of drag is half a turn: over the top to behind.
  await pg.click('[data-view="front"]'); await settle();
  check('front view', JSON.stringify(await cam()), /^\{"at":\[0,0,1\],"up":\[0,1,0\]\}$/);
  await drag(0, rect.h / 4);
  check('a quarter turn down looks straight down', JSON.stringify(await cam()), /^\{"at":\[0,1,0\],"up":\[0,0,-1\]\}$/);
  await drag(0, rect.h / 4);
  check('and it keeps turning: from behind, upside down (it used to stop at the top)', JSON.stringify(await cam()), /^\{"at":\[0,0,-1\],"up":\[0,-1,0\]\}$/);
  await drag(rect.h / 4, 0);
  check('upside down, a sideways drag still turns the model with the cursor', JSON.stringify(await cam()), /^\{"at":\[-1,0,0\],"up":\[0,-1,0\]\}$/);
  await drag(-rect.h / 4, 0);
  await drag(0, rect.h / 2);
  check('a full turn over the top comes back to the front', JSON.stringify(await cam()), /^\{"at":\[0,0,1\],"up":\[0,1,0\]\}$/);
  await drag(rect.h / 2, 0); await drag(rect.h / 2, 0);
  check('two half turns sideways make a full turn', JSON.stringify(await cam()), /^\{"at":\[0,0,1\],"up":\[0,1,0\]\}$/);
  await drag(0, rect.h / 2);
  await pg.click('[data-view="iso"]'); await settle();
  check('a standard view is upright again', JSON.stringify((await cam()).up), /^\[0,1,0\]$/);

  // B. Pick an axis on the shaft's Ø20 cylinder: the shaft moves along it.
  await pg.keyboard.press('v');
  const c20 = await pg.evaluate(() => {
    const p = __qs.parts.find(q => q.name === 'shaft'), topo = __qs.topology(p.mesh.geometry), n = Math.max(...topo.faceId) + 1;
    for (let f = 0; f < n; f++){ const e = __qs.faceEntity(p, f, null); if (e.geom.type === 'cylinder' && Math.abs(e.geom.r - 0.01) < 1e-9) return {p:e.geom.p.toArray(), a:e.geom.a.toArray(), h:(e.geom.h0 + e.geom.h1) / 2}; }
    return null;
  });
  const onCylinder = () => pg.evaluate((c) => {          // the screen point of the Ø20 surface facing the camera
    const T = __qs.THREE, a = new T.Vector3(...c.a), sh = __qs.parts.find(q => q.name === 'shaft');
    const o = new T.Vector3(...c.p).addScaledVector(a, c.h).add(sh.offset);
    const toCam = __qs.camera.position.clone().sub(o); toCam.addScaledVector(a, -toCam.dot(a)).normalize();
    const v = o.addScaledVector(toCam, 0.0098).project(__qs.camera), r = document.getElementById('canvas3d').getBoundingClientRect();
    return {x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height};
  }, c20);
  const state = () => pg.evaluate(() => ({axis: document.getElementById('axisName').textContent, part: __qs.selected && __qs.selected.name,
    d: __qs.moveAxis && __qs.moveAxis.d.toArray().map(v => +v.toFixed(6) || 0), box: document.getElementById('moveDist').value,
    off: Object.fromEntries(__qs.parts.map(p => [p.name, p.offset.toArray().map(v => +(v * 1000).toFixed(4) || 0)]))}));
  await pg.click('#btnAxisPick');
  const empty = await pg.evaluate(() => { const r = document.getElementById('canvas3d').getBoundingClientRect(); return {x: r.left + 30, y: r.top + 30}; });
  await pg.mouse.click(empty.x, empty.y); await pg.waitForTimeout(60);
  check('a click on nothing picks no axis, and waits for the next', JSON.stringify([await pg.evaluate(() => __qs.axisPickMode), (await state()).axis]), /^\[true,"none"\]$/);
  const hit = await onCylinder();
  await pg.mouse.click(hit.x, hit.y); await pg.waitForTimeout(60);
  let s = await state();
  console.log('   picked:', JSON.stringify(s));
  check('the cylinder\'s axis is picked, its part selected', `${s.axis} | ${s.part} | ${s.d}`, /^cylinder Ø20\.00 mm \| shaft \| 0,0,1$/);
  check('the box reads 0 before any move', s.box, /^0$/);
  await pg.fill('#moveDist', '25'); await pg.press('#moveDist', 'Enter'); await pg.waitForTimeout(60);
  s = await state();
  check('typing 25 moves the shaft exactly 25 mm along +Z, nothing else moves', JSON.stringify(s.off), /^\{"plate":\[0,0,0\],"shaft":\[0,0,25\],"bracket":\[0,0,0\]\}$/);
  await pg.fill('#moveDist', '-7.5'); await pg.press('#moveDist', 'Enter'); await pg.waitForTimeout(60);
  check('a negative distance goes the other way', JSON.stringify((await state()).off.shaft), /^\[0,0,-7\.5\]$/);
  await pg.fill('#moveDist', '25'); await pg.press('#moveDist', 'Enter'); await pg.waitForTimeout(60);

  // C. Drag the arrow 80 px along itself: the part follows the cursor in round steps; the view stays put.
  const handle = async () => pg.evaluate(() => { const h = __qs.moveHandle(), r = document.getElementById('canvas3d').getBoundingClientRect();
    return h && h.u && {x: r.left + h.c.x, y: r.top + h.c.y, u: h.u}; });
  const h0 = await handle();
  check('the handle is drawn on the shaft', h0 ? 'yes' : 'no', /^yes$/);
  const camBefore = await pg.evaluate(() => __qs.camera.position.toArray());
  const step = await pg.evaluate(() => __qs.moveStep(__qs.selected));
  await pg.mouse.move(h0.x + h0.u.x * 20, h0.y + h0.u.y * 20);
  check('the cursor shows the handle can be grabbed', await pg.evaluate(() => document.getElementById('canvas3d').style.cursor), /^grab$/);
  await pg.mouse.down();
  for (let i = 1; i <= 16; i++) await pg.mouse.move(h0.x + h0.u.x * (20 + 5 * i), h0.y + h0.u.y * (20 + 5 * i));
  await pg.waitForTimeout(60);
  await pg.screenshot({path: L.OUT + '20_move_drag.png'});
  await pg.mouse.up(); await pg.waitForTimeout(60);
  const h1 = await handle(); s = await state();
  const moved = Math.hypot(h1.x - h0.x, h1.y - h0.y), z = s.off.shaft[2];
  console.log(`   dragged 80 px: the handle moved ${moved.toFixed(1)} px, the shaft to z + ${z} mm (step ${(step * 1000).toFixed(3)} mm)`);
  check('the part follows the cursor along the axis', Math.abs(moved - 80) < 8 && z > 25 ? 'ok' : moved.toFixed(1) + ' px', /^ok$/);
  check('in whole steps', Math.abs(z / (step * 1000) - Math.round(z / (step * 1000))) < 1e-6 ? 'ok' : z + ' mm', /^ok$/);
  check('the box shows where it went', s.box, new RegExp('^' + String(+z.toFixed(3)).replace('.', '\\.') + '$'));
  check('the drag did not turn the view', String(await pg.evaluate((b) => __qs.camera.position.distanceTo(new __qs.THREE.Vector3(...b)) < 1e-9, camBefore)), /^true$/);
  check('nor deselect the part', s.part, /^shaft$/);

  // D. Along: Axis explodes the whole assembly along the picked axis; Reset puts everything back.
  await pg.click('[data-exp="axis"]');
  await pg.$eval('#expAmount', el => { el.value = 50; el.dispatchEvent(new Event('input')); });
  s = await state();
  check('Along Axis moves parts along Z only', JSON.stringify(Object.values(s.off).map(o => [o[0], o[1]])), /^\[\[0,0\],\[0,0\],\[0,0\]\]$/);
  await pg.click('#btnSection'); await pg.click('[data-sec="front"]');
  const drift = await pg.evaluate(() => Math.max(...__qs.parts.map(p => Math.abs(p.clip.distanceToPoint(p.restCenter.clone().add(p.offset)) - __qs.sectionPlane.distanceToPoint(p.restCenter)))));
  check('each moved part keeps the cut it had assembled', drift < 1e-12 ? 'ok' : String(drift), /^ok$/);
  await pg.click('#btnSecOff'); await pg.click('#btnSection');
  await pg.keyboard.press('f'); await pg.waitForTimeout(150);
  await pg.screenshot({path: L.OUT + '20_move_along_axis.png'});
  await pg.click('#btnExpReset');
  s = await state();
  check('Reset puts every part back, moves too', JSON.stringify(Object.values(s.off)) + ' ' + s.box, /^\[\[0,0,0\],\[0,0,0\],\[0,0,0\]\] 0$/);

  // E. Esc leaves Pick…; a new model forgets the axis.
  await pg.click('#btnAxisPick'); await pg.keyboard.press('Escape');
  check('Esc leaves Pick…', String(await pg.evaluate(() => __qs.axisPickMode)), /^false$/);
  const bad = errors.filter(e => /^(error|pageerror)/.test(e) && !/Failed to load resource/.test(e));
  console.log('   console:', errors.filter(e => !/Failed to load resource/.test(e)));
  check('no errors in the console', bad.join(' | ') || 'none', /^none$/);
  console.log(L.failures() ? L.failures() + ' FAILURES' : 'ALL PASS');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
