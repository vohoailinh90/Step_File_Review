const L = require('./lib.js');
const {launch, setCam, click, panel, hideAllBut, check} = L;
const fs = require('fs');
(async () => {
  const port = process.env.QS_STEPVIEW_PORT;
  if (!port) throw new Error('QS_STEPVIEW_PORT is not set: run this test through run.js');
  const browser = await launch();
  const pg = await browser.newPage({viewport:{width:1400, height:900}});
  const errors = [];
  pg.on('pageerror', e => errors.push(e.message)); pg.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await pg.goto('http://127.0.0.1:' + port + '/');
  await pg.setInputFiles('#fileinput', L.MODELS + 'asm.step');
  try {
    await pg.waitForFunction(() => window.__qs && __qs.parts.length === 3 && document.getElementById('drop').classList.contains('hidden'), null, {timeout:60000});
  } catch (e) {
    // say what the page was doing: a conversion error reaches console.error, a slow one the spinner
    const st = await pg.evaluate(() => ({spin: document.getElementById('spin').textContent,
      toast: (document.getElementById('toast') || {}).textContent, parts: window.__qs ? __qs.parts.length : null})).catch(x => String(x));
    console.log('FAIL converted model never loaded:', JSON.stringify(st), '| page errors:', JSON.stringify(errors));
    throw e;
  }
  const st = await pg.evaluate(() => ({load: document.getElementById('loadtime').textContent, brep: __qs.parts.map(p => p.name + ':' + (p.mesh.geometry.userData.brep ? p.mesh.geometry.userData.brep.faces.length + ' faces' : 'none')),
    engine: document.getElementById('enginewarn').classList.contains('show')}));
  console.log('  loaded:', st.load, '| B-rep data:', st.brep.join(', '), '| engine warning shown:', st.engine);
  check('converted file carries B-rep data', st.brep.join(' '), /plate:13 faces shaft:6 faces bracket:10 faces/);
  await pg.keyboard.press('m');
  await hideAllBut(pg, ['shaft']);
  await pg.evaluate(() => __qs.camera.up.set(0, 0, 1));
  await setCam(pg, [0.06, -0.10, 0.09], [-0.03, 0, 0.035]);
  // fillet torus via real conversion
  const o = await pg.evaluate(() => { const v = new __qs.THREE.Vector3(0, 0, 0.032).applyMatrix4(__qs.parts.find(p => p.name === 'shaft').restMatrix); return [v.x, v.y, v.z]; });
  const dx = 0.06 - o[0], dy = -0.10 - o[1], l = Math.hypot(dx, dy), c = Math.SQRT1_2, rr = 0.008 - 0.002*c;
  await click(pg, [o[0] + rr*dx/l, o[1] + rr*dy/l, o[2] - 0.002*c]);
  check('fillet radius from the real pipeline', await panel(pg), /A · Torus R2\.000 .*tube radius R2\.000 mm.*source exact \(STEP B-rep\)/);
  console.log('  errors:', errors);
  console.log(L.failures() ? L.failures() + ' FAILURES' : 'ALL PASS');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
