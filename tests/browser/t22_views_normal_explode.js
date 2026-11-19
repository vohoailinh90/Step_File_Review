const L = require('./lib.js');
const {launch, openModel, check} = L;
// t22: Ctrl+1 … Ctrl+6 set Front, Rear, Top, Bottom, Left, Right from real key presses (and a plain
// digit still changes the mode, not the view); Normal to looks square at a clicked face; Explode with
// scope Picked moves only the parts picked, together, along the chosen direction.
(async () => {
  const browser = await launch();
  const {pg, errors} = await openModel(browser, 'asm_brep.glb', 'asm.step');
  const cam = () => pg.evaluate(() => { const o = __qs.camera.position.clone().sub(__qs.controls.target).normalize();
    return {at: o.toArray().map(v => +v.toFixed(3) || 0), up: __qs.camera.up.toArray().map(v => +v.toFixed(3) || 0)}; });
  const ctrl = async d => { await pg.keyboard.down('Control'); await pg.keyboard.press('Digit' + d); await pg.keyboard.up('Control'); await pg.waitForTimeout(60); };
  await pg.click('#canvas3d', {position:{x:5, y:5}});      // focus the page, not a field

  const want = {1:'{"at":[0,0,1],"up":[0,1,0]}', 2:'{"at":[0,0,-1],"up":[0,1,0]}', 3:'{"at":[0,1,0],"up":[0,0,-1]}',
                4:'{"at":[0,-1,0],"up":[0,0,1]}', 5:'{"at":[-1,0,0],"up":[0,1,0]}', 6:'{"at":[1,0,0],"up":[0,1,0]}'};
  const name = {1:'Front', 2:'Rear', 3:'Top', 4:'Bottom', 5:'Left', 6:'Right'};
  for (const d of [1, 2, 3, 4, 5, 6]){
    await ctrl(d);
    check('Ctrl+' + d + ' is ' + name[d], JSON.stringify(await cam()), new RegExp('^' + want[d].replace(/[[\]{}.]/g, '\\$&') + '$'));
  }
  await ctrl(1);
  check('Ctrl+1 leaves the selection mode alone', await pg.evaluate(() => __qs.mode), /^part$/);
  await pg.keyboard.press('Digit2');
  check('a plain 2 is still Face mode', await pg.evaluate(() => __qs.mode), /^face$/);
  await pg.keyboard.press('Digit1');

  // Normal to: from the iso view, pick the face under the middle of the view
  await pg.click('[data-view="iso"]'); await pg.waitForTimeout(80);
  await pg.click('#btnNormal');
  check('Normal to waits for a face', await pg.evaluate(() => document.getElementById('btnNormal').classList.contains('active')), /^true$/);
  const box = await pg.locator('#canvas3d').boundingBox();
  await pg.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await pg.waitForTimeout(80);
  const c = await cam();
  check('Normal to looks along one face normal: the box faces are axis-aligned, so one axis', JSON.stringify(c.at.map(Math.abs).sort()), /^\[0,0,1\]$/);
  await pg.click('#btnNormal');
  await pg.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await pg.waitForTimeout(80);
  check('asked again on the same face it looks from the other side',
        JSON.stringify((await cam()).at), new RegExp('^' + JSON.stringify(c.at.map(v => -v || 0)).replace(/[[\]]/g, '\\$&') + '$'));

  // Explode, scope Picked
  await pg.click('[data-view="iso"]'); await pg.waitForTimeout(80);
  await pg.click('#btnExplode');
  await pg.click('#btnExpPick');
  await pg.mouse.click(box.x + box.width / 2, box.y + box.height / 2); await pg.waitForTimeout(60);
  await pg.click('#btnExpPick');
  const picked = await pg.evaluate(() => __qs.parts.filter(p => p.rowEl.classList.contains('expsel')).map(p => p.name));
  check('one part picked, its row marked', String(picked.length), /^1$/);
  check('the count reads 1 and the scope is Picked',
        await pg.evaluate(() => document.getElementById('expPickCount').textContent + ' ' + document.querySelector('[data-expscope="picked"]').classList.contains('active')), /^1 true$/);
  await pg.click('[data-exp="x"]');
  await pg.evaluate(() => { const r = document.getElementById('expAmount'); r.value = 50; r.dispatchEvent(new Event('input')); });
  const offs = await pg.evaluate(() => __qs.parts.map(p => [p.name, p.offset.toArray(), __qs.modelSize]));
  const moved = offs.filter(o => Math.hypot(...o[1]) > 0);
  check('only the picked part moved', JSON.stringify(moved.map(o => o[0])), new RegExp('^' + JSON.stringify(picked).replace(/[[\]]/g, '\\$&') + '$'));
  check('by half a model size along +X', moved.length === 1 && Math.abs(moved[0][1][0] - moved[0][2] / 2) < 1e-9 && !moved[0][1][1] && !moved[0][1][2], /^true$/);
  await pg.click('#btnExpFlip');
  check('Flip sends it along -X', await pg.evaluate(() => __qs.parts.find(p => p.offset.lengthSq() > 0).offset.x < 0), /^true$/);
  await pg.click('#btnExpClear');
  check('Clear returns the scope to All, which explodes every part again along X (50 %: once its X distance from the centre)',
        await pg.evaluate(() => __qs.parts.every(p => Math.abs(p.offset.x - (p.restCenter.x - __qs.modelCenter.x)) < 1e-12 && !p.offset.y && !p.offset.z)
                                 + ' ' + document.querySelector('[data-expscope="all"]').classList.contains('active')), /^true true$/);
  const bad = errors.filter(e => /^(error|pageerror)/.test(e) && !/Failed to load resource/.test(e));
  check('no errors in the console', bad.join(' | ') || 'none', /^none$/);
  console.log(L.failures() ? L.failures() + ' FAILURES' : 'ALL PASS');
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
