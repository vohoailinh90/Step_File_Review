const L = require('./lib.js');
const {launch, openModel, setCam, click, hideAllBut, check, OUT} = L;
// t25: Plane → Through: Two axes, through the real panel: the shaft (axis Z at (-30, 0)) and the Ø16 hole
// (axis Z at (20, 0)) are parallel and 50 mm apart, so the plane through both is y = 0; the Ø10 hole the
// shaft stands over is the shaft's own line and gives no plane.
(async () => {
  const browser = await launch();
  const {pg, errors} = await openModel(browser, 'asm_brep.glb', 'asm.step');
  const text = id => pg.evaluate(i => document.getElementById(i).textContent, id);
  const hidden = id => pg.evaluate(i => document.getElementById(i).hidden, id);
  const nodes = () => pg.evaluate(() => __qs.scene.children.filter(o => /^datum plane/.test(o.name)).map(o => [o.name, o.children.find(c => c.isMesh).userData.normal.toArray().map(v => +Math.abs(v).toFixed(3) || 0)]));
  const cam = [0.10, -0.12, 0.12];
  const far = (cx, cy, r, z) => { const dx = cam[0]-cx, dy = cam[1]-cy, l = Math.hypot(dx, dy); return [cx - r*dx/l, cy - r*dy/l, z]; };
  const near = (cx, cy, r, z) => { const dx = cam[0]-cx, dy = cam[1]-cy, l = Math.hypot(dx, dy); return [cx + r*dx/l, cy + r*dy/l, z]; };

  await pg.click('#canvas3d', {position:{x:5, y:5}});
  await pg.keyboard.press('d'); await pg.waitForTimeout(60);
  check('the angle rows show first', JSON.stringify([await hidden('datumRowFrom'), await hidden('datumRowAngle'), await hidden('datumRowAxis2')]), /^\[false,false,true\]$/);
  await pg.click('#btnDatumModeTwo'); await pg.waitForTimeout(60);
  check('Two axes: Axis 2 shows, From and Angle hide', JSON.stringify([await hidden('datumRowFrom'), await hidden('datumRowAngle'), await hidden('datumRowAxis2')]), /^\[true,true,false\]$/);
  check('the title says so', await text('datumTitle'), /^Plane through two axes$/);
  check('and the hint asks for two axes', await text('datumHint'), /Pick two parallel axes/);

  await hideAllBut(pg, ['plate', 'shaft']);                                // the bracket stands in front of the Ø16 hole
  await setCam(pg, cam, [-0.005, 0, 0]);
  await pg.click('#btnDatumAxis'); await pg.waitForTimeout(40);
  await click(pg, near(-0.03, 0, 0.010, 0.020));                          // the shaft's Ø20 side facing the camera
  check('Axis: the shaft', await text('datumAxisName'), /^cylinder Ø20\.00 mm, \+ along \+Z$/);
  await pg.click('#btnDatumAxis2'); await pg.waitForTimeout(40);
  await click(pg, far(0.02, 0, 0.008, 0.0));                              // the Ø16 hole's far wall
  check('Axis 2: the Ø16 hole', await text('datumAxis2Name'), /^cylinder Ø16\.00 mm, \+ along \+Z$/);
  check('the plane through both is y = 0', JSON.stringify(await nodes()), /^\[\["datum plane Plane",\[0,1,0\]\]\]$/);
  check('50 mm apart, exact', await text('datumHint'), /^Through both axes, 50\.00 mm apart\. They are on two parts: the plane is through them as assembled/);
  await pg.screenshot({path: OUT + 't25_two_axes.png'});

  await pg.click('#btnDatumLook'); await pg.waitForTimeout(120);
  const c = await pg.evaluate(() => __qs.camera.position.clone().sub(__qs.controls.target).normalize().toArray());
  check('Look: square to it', Math.abs(c[1]).toFixed(3), /^1\.000$/);
  check('with the axes upright', await pg.evaluate(() => __qs.camera.up.toArray().map(v => +v.toFixed(3) || 0).join()), /^0,0,1$/);
  check('and says what it is', await text('toast'), /Normal to the plane through two axes as assembled$/);
  await pg.click('#btnDatumKeep'); await pg.waitForTimeout(60);
  check('Keep names it P1', JSON.stringify((await nodes()).map(n => n[0])), /^\["datum plane P1"\]$/);

  // the Ø10 hole is the shaft's own line
  await setCam(pg, cam, [-0.005, 0, 0]);
  await hideAllBut(pg, ['plate']);
  await pg.click('#btnDatumAxis2'); await pg.waitForTimeout(40);
  await click(pg, far(-0.03, 0, 0.005, 0.001));
  check('Axis 2: the Ø10 hole', await text('datumAxis2Name'), /^cylinder Ø10\.00 mm/);
  check('one line: no plane, and the panel says so', await text('datumHint'), /one line/);
  check('Look is off', String(await pg.evaluate(() => document.getElementById('btnDatumLook').disabled)), /^true$/);

  await pg.click('#btnDatumModeAngle'); await pg.waitForTimeout(60);
  check('back to Axis + angle: the angle rows return', JSON.stringify([await hidden('datumRowFrom'), await hidden('datumRowAngle'), await hidden('datumRowAxis2')]), /^\[false,false,true\]$/);
  await pg.click('#btnDatumClear'); await pg.waitForTimeout(60);
  check('Clear takes the planes away', JSON.stringify(await nodes()), /^\[\]$/);
  const bad = errors.filter(e => /^(error|pageerror)/.test(e) && !/Failed to load resource/.test(e));
  check('no errors in the console', bad.join(' | ') || 'none', /^none$/);
  await browser.close();
  process.exit(L.failures() ? 1 : 0);
})();
