const L = require('./lib.js');
const {launch, openModel, setCam, click, panel, hideAllBut, check} = L;
(async () => {
  const browser = await launch();
  // Finding 1: raw units carry no "mm" anywhere; a new model resets the unit mode
  {
    const {pg, errors} = await openModel(browser, 'asm_brep.glb', 'asm.step');
    await hideAllBut(pg, ['plate']);
    const cam = [0.10, -0.12, 0.12];
    await setCam(pg, cam, [-0.005, 0, 0]);
    const far = (cx, cy, r, z) => { const dx = cam[0]-cx, dy = cam[1]-cy, l = Math.hypot(dx, dy); return [cx - r*dx/l, cy - r*dy/l, z]; };
    await pg.keyboard.press('4');
    await click(pg, far(-0.03, 0, 0.005, 0.001)); await click(pg, far(0.02, 0, 0.008, 0.0));
    await pg.click('#unitToggle');
    const raw = await pg.evaluate(() => ({panel: document.getElementById('measbody').textContent, label: document.getElementById('stUnits').textContent,
      dims: __qs.annotItems().filter(i => i.type === 'dim').length}));
    check('raw: status bar says raw', raw.label, /^raw$/);
    check('raw: panel has no mm', raw.panel, /^(?!.*mm).*centre distance.*0\.0500/);
    // the labels actually drawn on the overlay canvas (what screenshots burn in): capture fillText over a redraw
    const drawn = () => pg.evaluate(async () => {
      const ctx = document.getElementById('annot').getContext('2d'), seen = [], orig = ctx.fillText;
      ctx.fillText = function(t, ...a){ seen.push(String(t)); return orig.call(this, t, ...a); };
      __qs.controls.dispatchEvent({type: 'change'});
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      delete ctx.fillText;
      return seen.join(' | ');
    });
    const rawDrawn = await drawn();
    console.log('   drawn (raw):', rawDrawn);
    check('raw: drawn dimension has no mm', rawDrawn, /^(?!.*mm)(?=.*\b0\.0500\b)/);
    await pg.click('#unitToggle');
    const mmAgain = await pg.evaluate(() => document.getElementById('measbody').textContent);
    check('mm again after toggling back', mmAgain, /centre distance50\.00 mm/);
    const mmDrawn = await drawn();
    console.log('   drawn (mm):', mmDrawn);
    check('mm: drawn dimension back in mm', mmDrawn, /\b50\.00 mm\b/);
    // toggle to raw, then load another model: back to mm
    await pg.click('#unitToggle');
    const buf = require('fs').readFileSync(L.MODELS + 'plate.stl');
    await pg.setInputFiles('#fileinput', {name:'plate.stl', mimeType:'application/octet-stream', buffer:buf});
    await pg.waitForFunction(() => document.getElementById('fname').textContent === 'plate.stl');
    check('new model resets units to mm', await pg.evaluate(() => document.getElementById('stUnits').textContent + ' ' + document.getElementById('stBbox').textContent), /^mm 100\.00 × 60\.00 × 10\.00 mm$/);
    console.log('  errors:', errors.filter(e => !/Failed to load resource/.test(e)));
    await pg.close();
  }
  // Finding 2: straight edges are exact only with B-rep data
  for (const [model, re] of [['asm_plain.glb', /source mesh$/], ['asm_brep.glb', /source exact \(STEP B-rep\)$/]]){
    const {pg} = await openModel(browser, model, model);
    await hideAllBut(pg, ['plate']);
    await setCam(pg, [0.10, -0.12, 0.12], [-0.005, 0, 0]);
    await pg.keyboard.press('4');
    await click(pg, [0.0, 0.03, 0.005]);                  // top edge along x at y=+30
    const one = await panel(pg);
    await click(pg, [0.05, 0.0, 0.005]);                  // top edge along y at x=+50
    const two = await panel(pg);
    check(model + ': single straight edge source', one, model.includes('brep') ? /Straight edge 90\.00 mm.*source exact/ : /Straight edge 90\.00 mm.*source mesh$/);
    check(model + ': edge pair source', two, re);
    check(model + ': perpendicular edges', two, /angle 90\.00°/);
    await pg.close();
  }
  console.log(L.failures() ? L.failures() + ' FAILURES' : 'ALL PASS');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
