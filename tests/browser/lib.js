// Shared helpers for the browser tests. Run them through run.js, which builds the test page
// and serves it; see README.md.
const { chromium } = require('playwright');
const path = require('path'), fs = require('fs');
const BASE = process.env.QS_BASE || 'http://127.0.0.1:8765/';
const MODELS = path.join(__dirname, 'models') + path.sep;          // test models, served at /models/
const OUT = path.join(__dirname, 'out') + path.sep;                // screenshots (not committed)
fs.mkdirSync(OUT, {recursive: true});
async function launch(){
  const browser = await chromium.launch({args:['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']});
  // an uncaught exception in the viewer fails the test, whatever its own checks say
  const newPage = browser.newPage.bind(browser);
  browser.newPage = async (...a) => {
    const pg = await newPage(...a);
    pg.on('pageerror', e => { fails++; console.log('FAIL uncaught page error: ' + e.message); });
    return pg;
  };
  return browser;
}
async function openModel(browser, model, name, page = 'viewer_test.html', vp = {width:1400, height:900}){
  const pg = await browser.newPage({viewport:vp, acceptDownloads:true});
  const errors = [];
  pg.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
  pg.on('pageerror', e => errors.push('pageerror: ' + e.message));
  await pg.goto(BASE + page + '?model=/models/' + model + '&name=' + encodeURIComponent(name || model));
  await pg.waitForFunction(() => window.__qs && __qs.parts.length > 0 && document.getElementById('drop').classList.contains('hidden'), null, {timeout:30000});
  await pg.waitForTimeout(200);
  return {pg, errors};
}
module.exports = {launch, openModel, BASE, MODELS, OUT};
async function setCam(pg, pos, target){
  await pg.evaluate(([p, t]) => { __qs.camera.position.set(...p); __qs.controls.target.set(...t); __qs.controls.update(); __qs.camera.updateMatrixWorld(); }, [pos, target]);
  await pg.waitForTimeout(60);
}
async function screen(pg, p){
  return pg.evaluate((p) => { const v = new __qs.THREE.Vector3(...p).project(__qs.camera); const r = document.getElementById('canvas3d').getBoundingClientRect();
    return {x: r.left + (v.x + 1) / 2 * r.width, y: r.top + (1 - v.y) / 2 * r.height}; }, p);
}
async function click(pg, p, dx = 0, dy = 0){ const s = await screen(pg, p); await pg.mouse.click(s.x + dx, s.y + dy); await pg.waitForTimeout(40); return s; }
async function panel(pg){ return pg.evaluate(() => [...document.getElementById('measbody').children].map(d => [...d.children].map(c => c.textContent.trim()).filter(Boolean).join(' ') || d.textContent.trim()).join(' | ')); }
async function hideAllBut(pg, names){ await pg.evaluate((names) => __qs.parts.forEach(p => __qs.setPartVisible(p, names.includes(p.name))), names); }
// world point of a part-local point (rest position)
async function world(pg, name, p){ return pg.evaluate(([n, p]) => { const q = __qs.parts.find(x => x.name === n); const v = new __qs.THREE.Vector3(...p).applyMatrix4(q.restMatrix); return [v.x, v.y, v.z]; }, [name, p]); }
let fails = 0;
function check(label, text, re){ const ok = re.test(text); if (!ok) fails++; console.log((ok ? 'PASS ' : 'FAIL ') + label + (ok ? '' : '\n      got: ' + text)); }
function failures(){ return fails; }
Object.assign(module.exports, {setCam, screen, click, panel, hideAllBut, world, check, failures});
