// Runs the browser tests against the repo's viewer.html. See README.md.
//
//   node run.js              all tests
//   node run.js t2 t18       only these
//   node run.js -v ...       stream each test's full output
//   node run.js --strict     a SKIP fails the run too (CI uses this: nothing may go untested)
//
// It builds www/viewer_test.html (viewer.html plus a window.__qs debug handle), serves it with
// the test models on a free loopback port, and runs each test in its own Node process.
// t5 also starts stepview.py's real /convert endpoint and needs Python with cascadio;
// t6 / t7 need models/big_brep.glb (python tools/make_models.py --big). Missing either is a SKIP.
'use strict';
const fs = require('fs'), path = require('path'), http = require('http'), cp = require('child_process');

const DIR = __dirname, ROOT = path.resolve(DIR, '..', '..');
const WWW = path.join(DIR, 'www'), MODELS = path.join(DIR, 'models'), OUT = path.join(DIR, 'out');
const TIMEOUT = 5 * 60 * 1000;

// [name, file, args]; t2 runs on the B-rep GLB and on the plain one
const TESTS = [
  ['t1', 't1_classify.js'],
  ['t2 brep', 't2_measure.js', ['asm_brep.glb']],
  ['t2 plain', 't2_measure.js', ['asm_plain.glb']],
  ['t3', 't3_visual.js'], ['t4', 't4_misc.js'], ['t5', 't5_server.js'], ['t6', 't6_perf.js'], ['t7', 't7_instances.js'],
  ['t8', 't8_edges.js'], ['t9', 't9_codex1.js'], ['t10', 't10_edges_explode.js'], ['t11', 't11_codex2.js'],
  ['t12', 't12_codex3.js'], ['t13', 't13_codex5.js'], ['t14', 't14_codex6.js'], ['t15', 't15_codex7.js'],
  ['t16', 't16_codex8.js'], ['t17', 't17_codex9.js'], ['t18', 't18_codex10.js'], ['t19', 't19_codex11.js'],
];
const REPORT_ONLY = new Set(['t1', 't6']);         // print figures, assert nothing

// debug handle appended to the viewer's IIFE, test copy only
const HOOK = `
window.__qs = {THREE, camera, controls, scene, renderer, VIEWS, frame, setMode, pick,
  get parts(){ return parts; }, get modelRoot(){ return modelRoot; }, get modelSize(){ return modelSize; },
  get modelCenter(){ return modelCenter; }, get mode(){ return mode; },
  topology: typeof topology === 'function' ? topology : null,
  faceInfo: typeof faceInfo === 'function' ? faceInfo : null,
  faceEntity: typeof faceEntity === 'function' ? faceEntity : null,
  describe: typeof describe === 'function' ? describe : null,
  relate: typeof relate === 'function' ? relate : null,
  minDistance: typeof minDistance === 'function' ? minDistance : null,
  setExplode: typeof setExplode === 'function' ? setExplode : null,
  edgeEntity: typeof edgeEntity === 'function' ? edgeEntity : null,
  classifyEdge: typeof classifyEdge === 'function' ? classifyEdge : null,
  measureClear: typeof measureClear === 'function' ? measureClear : null,
  addMeasureEntity: typeof addMeasureEntity === 'function' ? addMeasureEntity : null,
  exactCircle: typeof exactCircle === 'function' ? exactCircle : null,
  notClipped: typeof notClipped === 'function' ? notClipped : null,
  dimText: typeof dimText === 'function' ? dimText : null,
  get sectionPlane(){ return typeof sectionPlane === 'undefined' ? null : sectionPlane; },
  get capGroup(){ return typeof capGroup === 'undefined' ? null : capGroup; },
  annotItems: typeof annotItems === 'function' ? annotItems : null,
  setPartVisible, toggleEdges, get edgesOn(){ return edgesOn; }, get whiteBg(){ return whiteBg; },
  get measA(){ return typeof measA === 'undefined' ? null : measA; },
  get measB(){ return typeof measB === 'undefined' ? null : measB; },
  get measItems(){ return typeof measItems === 'undefined' ? null : measItems; },
  get keptItems(){ return typeof keptItems === 'undefined' ? null : keptItems; },
  get explodeAmt(){ return typeof explodeAmt === 'undefined' ? 0 : explodeAmt; },
};
`;

function buildPage(){
  const src = fs.readFileSync(path.join(ROOT, 'viewer.html'), 'utf8');
  const end = src.lastIndexOf('})();');
  if (end < 0) throw new Error('viewer.html: the closing })(); of the app IIFE was not found');
  fs.mkdirSync(WWW, {recursive: true});
  const page = path.join(WWW, 'viewer_test.html');
  fs.writeFileSync(page, src.slice(0, end) + HOOK + src.slice(end));
  return page;
}

const TYPES = {'.html': 'text/html; charset=utf-8', '.glb': 'model/gltf-binary', '.stl': 'model/stl', '.step': 'model/step'};
function serve(){
  const server = http.createServer((req, res) => {
    const url = decodeURIComponent(req.url.split('?')[0]);
    // only two places: the built page(s), and models/ by bare file name
    const file = url.startsWith('/models/') ? path.join(MODELS, path.basename(url)) : path.join(WWW, path.basename(url));
    fs.readFile(file, (err, body) => {
      if (err){ res.writeHead(404); res.end('Not found'); return; }
      res.writeHead(200, {'Content-Type': TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store'});
      res.end(body);
    });
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => ok(server)));
}

// the first Python that imports cascadio: $PYTHON, then python, python3, py
function findPython(){
  const cands = [process.env.PYTHON, 'python', 'python3', 'py'].filter(Boolean);
  for (const c of cands){
    const r = cp.spawnSync(c, ['-c', 'import cascadio'], {stdio: 'ignore', windowsHide: true});
    if (r.status === 0) return c;
  }
  return null;
}

function startStepview(py, page){
  const cache = fs.mkdtempSync(path.join(require('os').tmpdir(), 'qs-test-cache-'));
  const proc = cp.spawn(py, [path.join(DIR, 'tools', 'serve_stepview.py'), page, cache], {stdio: ['pipe', 'pipe', 'inherit'], windowsHide: true});
  return new Promise((ok, fail) => {
    let buf = '';
    const t = setTimeout(() => fail(new Error('stepview.py did not start')), 30000);
    proc.stdout.on('data', d => {
      buf += d;
      const m = buf.match(/port (\d+)/);
      if (m){ clearTimeout(t); ok({port: m[1], stop(){ proc.stdin.end(); proc.kill(); try { fs.rmSync(cache, {recursive: true, force: true}); } catch {} }}); }
    });
    proc.on('exit', c => { clearTimeout(t); fail(new Error('stepview.py exited with ' + c)); });
  });
}

function runTest(file, args, env, verbose){
  return new Promise(ok => {
    const proc = cp.spawn(process.execPath, [path.join(DIR, file), ...(args || [])], {cwd: DIR, env, windowsHide: true});
    let out = '';
    const take = d => { out += d; if (verbose) process.stdout.write(d); };
    proc.stdout.on('data', take); proc.stderr.on('data', take);
    const t = setTimeout(() => { out += '\n[run.js] timed out\n'; proc.kill(); }, TIMEOUT);
    proc.on('close', code => { clearTimeout(t); ok({code, out}); });
  });
}

(async () => {
  const argv = process.argv.slice(2), verbose = argv.includes('-v'), strict = argv.includes('--strict');
  const only = argv.filter(a => a !== '-v' && a !== '--strict');
  const tests = only.length ? TESTS.filter(([n]) => only.includes(n.split(' ')[0])) : TESTS;
  if (!tests.length){ console.error('no test matches: ' + only.join(' ')); process.exit(2); }
  try { require.resolve('playwright', {paths: [DIR, ...(process.env.NODE_PATH || '').split(path.delimiter).filter(Boolean)]}); }
  catch { console.error('playwright is not installed: in tests/browser run  npm install --no-save playwright@1.56.1  then  npx playwright install chromium'); process.exit(2); }

  fs.mkdirSync(OUT, {recursive: true});
  const page = buildPage();
  const server = await serve();
  const env = {...process.env, QS_BASE: `http://127.0.0.1:${server.address().port}/`};
  let stepview = null;
  const results = [];
  for (const [name, file, args] of tests){
    const t0 = Date.now();
    let skip = null, error = null;
    if (name === 't6' || name === 't7'){
      if (!fs.existsSync(path.join(MODELS, 'big_brep.glb'))) skip = 'needs models/big_brep.glb: python tools/make_models.py --big';
    }
    if (name === 't5' && !stepview){
      const py = findPython();
      if (!py) skip = 'needs Python with cascadio (set PYTHON to choose the interpreter)';
      else {
        // only a missing cascadio is a skip: a usable Python whose stepview.py won't serve is a failure
        try { stepview = await startStepview(py, page); }
        catch (e){ error = 'stepview.py (' + py + '): ' + e.message; }
      }
    }
    if (skip){ results.push([name, 'SKIP', skip]); console.log(`SKIP  ${name.padEnd(9)} ${skip}`); continue; }
    if (error){ results.push([name, 'ERROR', error]); console.log(`ERROR ${name.padEnd(9)} ${error}`); continue; }
    const r = await runTest(file, args, name === 't5' ? {...env, QS_STEPVIEW_PORT: stepview.port} : env, verbose);
    const log = name.replace(' ', '_') + '.log';
    fs.writeFileSync(path.join(OUT, log), r.out);
    const fails = r.out.split(/\r?\n/).filter(l => /^FAIL /.test(l));
    const status = r.code !== 0 ? 'ERROR' : fails.length || /\d+ FAILURES/.test(r.out) ? 'FAIL' : 'PASS';
    const note = status === 'PASS' ? (REPORT_ONLY.has(name) ? 'report only, see out/' + log : '') : 'see out/' + log;
    results.push([name, status, note]);
    console.log(`${status.padEnd(5)} ${name.padEnd(9)} ${((Date.now() - t0) / 1000).toFixed(1).padStart(5)} s  ${note}`);
    if (status === 'FAIL' && !verbose) fails.forEach(l => console.log('        ' + l));
    if (status === 'ERROR' && !verbose) console.log(r.out.split(/\r?\n/).slice(-8).map(l => '        ' + l).join('\n'));
  }
  if (stepview) stepview.stop();
  server.close();
  const n = s => results.filter(r => r[1] === s).length;
  console.log(`\n${n('PASS')} passed, ${n('FAIL')} failed, ${n('ERROR')} errors, ${n('SKIP')} skipped`);
  if (strict && n('SKIP')) console.log('--strict: a skipped test is a failure here; install what the SKIP line names');
  process.exit(n('FAIL') || n('ERROR') || (strict && n('SKIP')) ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
