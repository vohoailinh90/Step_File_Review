const L = require('./lib.js');
const {launch, openModel, setCam, click, panel, hideAllBut, check} = L;
(async () => {
  const browser = await launch();
  // 1. Section > "Plane from circle…" then click a circular edge (threw "pickCircle is not defined" before PR #2)
  {
    const page = 'viewer_test.html';
    const {pg, errors} = await openModel(browser, 'asm_brep.glb', 'asm.step', page);
    await hideAllBut(pg, ['plate']);
    await pg.evaluate(() => { __qs.camera.up.set(0, 0, 1); });
    await setCam(pg, [0.02, -0.03, 0.12], [0.02, 0, 0]);
    await pg.click('#btnSection');
    await pg.click('#btnPickCircle');
    await click(pg, [0.02 + 0.009*0.7071, 0.009*0.7071, 0.005]);   // chamfer top rim, Ø18
    const r = await pg.evaluate(() => ({hint: document.getElementById('secHint').textContent, info: document.getElementById('info').innerText.replace(/\n+/g, ' | ')}));
    const errs = errors.filter(e => !/Failed to load resource/.test(e));
    console.log('  [' + page + '] errors:', errs, '\n     hint:', r.hint, '\n     info:', r.info);
    check('plane from circle works', r.hint + ' ' + errs.length, /Ø18\.00 mm circle.* 0$/);
    await pg.close();
  }
  // 2. STL: top/bottom plane distance, holes
  {
    const {pg, errors} = await openModel(browser, 'plate.stl', 'plate.stl');
    await pg.keyboard.press('4');
    await pg.evaluate(() => { __qs.camera.up.set(0, 0, 1); });
    const cam = [100, -120, 120];
    await setCam(pg, cam, [-5, 0, 0]);
    const far = (cx, cy, r, z) => { const dx = cam[0]-cx, dy = cam[1]-cy, l = Math.hypot(dx, dy); return [cx - r*dx/l, cy - r*dy/l, z]; };
    await click(pg, far(-30, 0, 5, 1));
    await click(pg, far(20, 0, 8, 0));
    const t = await panel(pg);
    check('STL hole to hole', t, /Cylinder \(hole\) Ø10\.00.*Cylinder \(hole\) Ø16\.00.*centre distance 50\.00 mm.*gap 37\.00 mm.*fitted to the mesh/);
    await pg.keyboard.press('Escape');
    await click(pg, [0, 20, 5]);
    const t2 = await panel(pg);
    check('STL top face', t2, /A · Plane plate \| normal 0\.000, 0\.000, 1\.000/);
    // units toggle: an STL is taken as mm, so "raw" is the same numbers without the unit. It used to
    // multiply every STL length by 1000 and still say mm. The panel and the status bar follow.
    const status = () => pg.evaluate(() => document.getElementById('stUnits').textContent + ' ' + document.getElementById('stBbox').textContent);
    const area = (t2.match(/area \(mesh\) (\d+) mm²/) || [])[1];      // the top face, holes and corners taken out
    await pg.click('#unitToggle');
    check('STL raw: the same numbers, no mm', (await panel(pg)) + ' || ' + (await status()), new RegExp('area \\(mesh\\) ' + area + ' \\|(?!.*mm).* \\|\\| raw 100\\.00 × 60\\.00 × 10\\.00$'));
    await pg.click('#unitToggle');
    check('STL back to mm, still the same numbers', (await panel(pg)) + ' || ' + (await status()), new RegExp('area \\(mesh\\) ' + area + ' mm².* \\|\\| mm 100\\.00 × 60\\.00 × 10\\.00 mm$'));
    // a .glb that fails to load leaves the STL on screen in its own mm, not x1000 (review of the fix)
    await pg.evaluate(() => __qs.loadArrayBuffer(new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0, 20, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8]).buffer, 'bad.glb'));
    await pg.waitForTimeout(200);
    await pg.keyboard.press('Escape');
    await click(pg, [0, 20, 5]);
    check('after a failed .glb the STL still reads its own mm', (await panel(pg)) + ' || ' + (await status()), new RegExp('area \\(mesh\\) ' + area + ' mm².* \\|\\| mm 100\\.00 × 60\\.00 × 10\\.00 mm$'));
    console.log('  STL errors:', errors.filter(e => !/Failed to load resource/.test(e)));
    await pg.close();
  }
  console.log(L.failures() ? L.failures() + ' FAILURES' : 'ALL PASS');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
