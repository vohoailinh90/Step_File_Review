// ── Background / screenshot ──────────────────────────────────
$('btnBg').addEventListener('click', toggleBg);
function toggleBg(){
  whiteBg = !whiteBg;
  scene.background = new THREE.Color(whiteBg ? LIGHT_BG : DARK_BG);
  if (edgeRoot) edgeRoot.children.forEach(l => l.material.color.setHex(whiteBg ? 0x333333 : 0x2a2a2a));
  $('btnBg').classList.toggle('active', whiteBg);
}
$('btnShot').addEventListener('click', screenshot);
function screenshot(){
  if (!modelRoot){ toast('Load a model first'); return; }
  const w = canvas.width, h = canvas.height;
  renderer.setSize(w*2, h*2, false);
  camera.aspect = w/h; camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  let shot = canvas;
  const items = annotItems();
  if (items.length){                  // burn the measurement annotations into the image
    shot = document.createElement('canvas');
    shot.width = canvas.width; shot.height = canvas.height;
    const ctx = shot.getContext('2d');
    ctx.drawImage(canvas, 0, 0);
    drawAnnotations(ctx, shot.width, shot.height, shot.width / (viewport.clientWidth || 1), items);
  }
  shot.toBlob(blob=>{
    renderer.setSize(w, h, false); resize();
    const a = document.createElement('a');
    const base = ($('fname').textContent || 'model').replace(/\.[^.]+$/,'');
    a.download = base + '_' + new Date().toISOString().slice(0,19).replace(/[:T]/g,'-') + '.png';
    a.href = URL.createObjectURL(blob); a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href), 5000);
    toast('Screenshot saved');
  }, 'image/png');
}
function toast(msg, ms){
  const t = $('toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toast._h); toast._h = setTimeout(()=>t.classList.remove('show'), ms || 2200);
}

$('unitToggle').addEventListener('click', ()=>{
  unitScale = unitScale === 1000 ? 1 : 1000;
  unitsRaw = unitScale !== 1000;
  $('stUnits').textContent = unitsRaw ? 'raw' : 'mm';
  if (bboxCached){
    const s2 = bboxCached.getSize(new THREE.Vector3());
    $('stBbox').textContent = [s2.x,s2.y,s2.z].map(v=>L(v)).join(' × ') + MM();
  }
  $('secOffsetVal').textContent = L(sectionOffset);
  if (mode === 'measure') renderMeasure();
  toast(unitScale === 1000 ? 'Lengths shown in mm (mesh × 1000)' : 'Lengths shown in raw mesh units');
});

// ── Keyboard ─────────────────────────────────────────────────
window.addEventListener('keydown', e=>{
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT') return;
  const k = e.key.toLowerCase();
  if (k === 'f') frame();
  else if (k === 's') screenshot();
  else if (k === 'e') toggleEdges();
  else if (k === 'b') toggleBg();
  else if (k === 'x') $('btnSection').click();
  else if (k === '1') setMode('part');
  else if (k === '2') setMode('face');
  else if (k === '3') setMode('edge');
  else if (k === '4') setMode('measure');
  else if (k === 'm') setMode(mode === 'measure' ? 'part' : 'measure');
  else if (k === 'v') $('btnExplode').click();
  else if (k === 'k' && mode === 'measure') measureKeep();
  else if ((k === 'delete' || k === 'backspace') && mode === 'measure') measureClear(true);
  else if (k === 'h' && selected) setPartVisible(selected, !selected.visible);
  else if (k === 'i' && selected) isolate(selected);
  else if (k === 'escape'){
    if (mode === 'measure') measureClear(!measA);     // first Esc drops the picks, the next the kept dimensions
    clearSelection(); circlePickMode = false; $('btnPickCircle').classList.remove('active');
  }
});

// ── Files ────────────────────────────────────────────────────
const HAS_SERVER = location.protocol === 'http:' || location.protocol === 'https:';
let convertMs = 0;
function handleFile(f){
  if (/\.(step|stp)$/i.test(f.name)) convertOnServer(f); else readFile(f);
}
function readFile(f){
  const r = new FileReader();
  r.onerror = () => fail(new Error('could not read ' + f.name));
  r.onload = () => loadArrayBuffer(r.result, f.name);
  r.readAsArrayBuffer(f);
}
function convertOnServer(f){
  if (!HAS_SERVER){
    fail(new Error('STEP conversion needs the local helper — run: python stepview.py "' + f.name + '"'));
    return;
  }
  const t0 = performance.now();
  spin(true, 'tessellating ' + f.name);
  $('drop').classList.add('hidden');
  fetch('/convert', {
    method:'POST',
    headers:{'X-Filename':encodeURIComponent(f.name), 'X-Quality':$('quality').value,
             'Content-Type':'application/octet-stream'},
    body:f
  })
  .then(res=>{
    if (!res.ok){
      const mark = m => { const e = new Error(m); e.plain = true; return e; };
      return res.json().then(j => { throw mark(j.error || ('HTTP '+res.status)); },
                             () => { throw mark('HTTP '+res.status); });
    }
    return res.arrayBuffer();
  })
  .then(buf=>{ convertMs = performance.now()-t0; loadArrayBuffer(buf, f.name, t0); })
  .catch(fail);
}
function openPicker(){ $('fileinput').click(); }
$('btnOpen').addEventListener('click', openPicker);
$('btnOpen2').addEventListener('click', openPicker);
$('fileinput').addEventListener('change', e=>{ if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value=''; });
['dragover','dragenter'].forEach(ev => window.addEventListener(ev, e=>{
  e.preventDefault(); $('drop').classList.remove('hidden'); $('drop').classList.add('dragover');
}));
window.addEventListener('dragleave', e=>{
  if (!e.relatedTarget){ $('drop').classList.remove('dragover'); if (modelRoot) $('drop').classList.add('hidden'); }
});
window.addEventListener('drop', e=>{
  e.preventDefault(); $('drop').classList.remove('dragover');
  const f = e.dataTransfer.files && e.dataTransfer.files[0];
  if (f) handleFile(f);
  else if (modelRoot) $('drop').classList.add('hidden');
});

// ── Engine status ────────────────────────────────────────────
if (HAS_SERVER){
  fetch('/status').then(r=>r.json()).then(j=>{
    if (!j.engine){
      $('enginewarn').classList.add('show');
      // stepview.py diagnoses; the page only shows it. An installed engine that
      // cannot load needs a different fix than a missing one.
      if (j.problem) $('engineproblem').textContent = j.problem;
      if (j.fix) $('pipcmd').textContent = j.fix;
    }
  }).catch(()=>{});
}

// ── Auto-load from launcher ──────────────────────────────────
const params = new URLSearchParams(location.search);
const modelUrl = params.get('model');
if (modelUrl){
  spin(true, 'loading mesh');
  Promise.resolve().then(()=>fetch(sameOrigin(modelUrl)))
    .then(r=>{ if(!r.ok) throw new Error('HTTP '+r.status); return r.arrayBuffer(); })
    .then(buf=>loadArrayBuffer(buf, params.get('name') || modelUrl.split('/').pop()))
    .catch(fail);
}
