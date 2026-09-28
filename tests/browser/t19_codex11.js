const L = require('./lib.js');
const {launch, openModel, check} = L;
// Codex round 12: a lone plane or freeform face draws its area, so Keep and screenshots carry it
(async () => {
  const browser = await launch();
  for (const model of ['asm_brep.glb', 'asm2_brep.glb', 'plate.stl']){
    const {pg, errors} = await openModel(browser, model, model);
    await pg.keyboard.press('4');
    const pickFace = test => pg.evaluate(t => {
      const pred = new Function('s', 'return ' + t);
      for (const part of __qs.parts){ const geo = part.mesh.geometry, topo = __qs.topology(geo);
        for (let f = 0; f < topo.fStart.length - 1; f++) if (pred(__qs.faceInfo(geo, f).surf)){
          __qs.measureClear(true); __qs.addMeasureEntity(__qs.faceEntity(part, f, null)); return part.name + '#' + f; } }
      return null; }, test);
    const state = () => pg.evaluate(() => ({keep:document.getElementById('btnMeasKeep').disabled ? 'disabled' : 'enabled',
      items:__qs.measItems.filter(i => i.type === 'tag' || i.type === 'dim').map(i => i.type + ':' + __qs.dimText(i)).join(','), kept:__qs.keptItems.length,
      area:([...document.getElementById('measbody').children].map(d => d.textContent).find(t => /area \(mesh\)/.test(t)) || '').replace(/\s+/g, ' ').trim()}));
    // [label, face test, required]: each model must contain the faces it was built with; asm has no freeform face
    const kinds = {
      'asm_brep.glb': [['plane', "s.type === 'plane'", true], ['freeform', "s.type === 'surface'", false]],
      'asm2_brep.glb': [['plane', "s.type === 'plane'", true], ['freeform', "s.type === 'surface'", true]],
      'plate.stl': [['freeform/plane', "s.type === 'plane' || s.type === 'surface'", true]],
    }[model];
    for (const [k, t, required] of kinds){
      const f = await pickFace(t);
      if (!f){
        if (required) check(`${model} has a ${k} face`, 'none found', /^found$/);
        else console.log('   (no ' + k + ' face in ' + model + ', as built)');
        continue;
      }
      let st = await state();
      console.log(`   ${model} ${k} ${f}:`, JSON.stringify(st));
      check(`${model} ${k}: Keep enabled`, st.keep, /^enabled$/);
      const num = (st.area.match(/([\d.]+) mm²/) || [])[1];
      check(`${model} ${k}: label = area row`, st.items, new RegExp('^tag:area ' + (num || 'X').replace('.', '\\.') + ' mm²$'));
      await pg.click('#unitToggle');
      st = await state();
      console.log(`   raw units:`, JSON.stringify(st));
      check(`${model} ${k}: label follows the unit toggle, as the panel does`, st.items + ' | ' + st.area, /^tag:area ([\d.e+-]+(?: mm²)?) \| area \(mesh\)\1$/);
      await pg.click('#unitToggle');
      await pg.keyboard.press('k');
      st = await state();
      check(`${model} ${k}: K keeps it`, String(st.kept), /^1$/);
    }
    if (model === 'asm_brep.glb'){
      await pickFace("s.type === 'cylinder'");
      const st = await state();
      check('cylinder alone: diameter only, no area label', st.items, /^dim:[^,]*$/);
    }
    console.log('   errors:', errors.filter(x => !/Failed to load resource/.test(x)));
    await pg.close();
  }
  console.log(L.failures() ? L.failures() + ' FAILURES' : 'ALL PASS');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
