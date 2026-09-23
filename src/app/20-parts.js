// ── Part list ────────────────────────────────────────────────
const EYE = '<svg class="eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7S1 12 1 12z"/><circle cx="12" cy="12" r="3"/></svg>';
function buildPartList(){
  const box = $('parts'); box.innerHTML = '';
  $('partcount').textContent = parts.length;
  parts.forEach(p=>{
    const row = document.createElement('div');
    row.className = 'part'; row.tabIndex = 0;
    row.innerHTML = EYE + '<span class="nm"></span><span class="tri"></span>';
    row.querySelector('.nm').textContent = p.name;
    row.querySelector('.tri').textContent = p.tris >= 1000 ? Math.round(p.tris/1000)+'k' : p.tris;
    row.title = p.name;
    row.addEventListener('click', ()=>{ selectPart(p, false); setPartVisible(p, !p.visible); });
    row.addEventListener('dblclick', ()=> isolate(p));
    row.addEventListener('mouseenter', ()=> hover(p, true));
    row.addEventListener('mouseleave', ()=> hover(p, false));
    p.rowEl = row; box.appendChild(row);
  });
}
function setPartVisible(p, v){
  p.visible = v; p.mesh.visible = v;
  p.rowEl.classList.toggle('hiddenpart', !v);
  if (p.edges) p.edges.visible = v && edgesOn;
  if (p.capBack){ p.capBack.visible = v; p.capFront.visible = v; }
}
function isolate(p){
  const onlyOne = parts.every(q => (q===p) === q.visible);
  parts.forEach(q => setPartVisible(q, onlyOne ? true : q === p));
}
let hovered = null;
function emis(p, hex){ const m = p.mesh.material; if (m && m.emissive) m.emissive.setHex(hex); }
function hover(p, on){
  if (hovered && hovered !== selected){ emis(hovered, 0); hovered.rowEl.classList.remove('highlight'); }
  hovered = null;
  if (on && p !== selected){ emis(p, 0x24402a); p.rowEl.classList.add('highlight'); hovered = p; }
}
$('btnShowAll').addEventListener('click', ()=> parts.forEach(p=>setPartVisible(p, true)));
$('btnInvert').addEventListener('click', ()=> parts.forEach(p=>setPartVisible(p, !p.visible)));
$('btnParts').addEventListener('click', ()=>{
  $('sidebar').classList.toggle('hidden'); $('btnParts').classList.toggle('active');
});

