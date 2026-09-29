// ── Move a part along an axis ────────────────────────────────
// Pick axis…, then click a straight edge, a circle or arc, a cylinder, cone or torus, or a flat
// face: its line, its axis or its normal is the axis, + pointing away from the assembly centre.
// The part it was picked on, or any part clicked after, moves along it by the distance typed in
// the explode panel, or by dragging the arrow drawn on it. A move is a world-space vector per part
// (`moved`) that applyExplode() adds to the explode offset, so edges, caps, section cuts and
// highlights follow it, and measurements keep using the assembled geometry. Along: Axis explodes
// the whole assembly along the same axis.
let moveAxis = null;                 // {p, d, part, geom}: a point on it (assembled), unit direction, where picked
let axisPickMode = false, moveDrag = null, moveHover = false;
const MOVE_PX = 60, MOVE_GRAB = 9;   // the handle's half-length, and how near the cursor must come to grab it (CSS px)
const MOVE_END_ON = 0.996;           // cos 5°: an axis this close to the line of sight has nothing to slide along
const _ma = new THREE.Vector3(), _mb = new THREE.Vector3();

$('btnAxisPick').addEventListener('click', ()=>{ if (axisPickMode) movePickCancel(); else movePickStart(); });
$('btnAxisFlip').addEventListener('click', ()=>{ if (moveAxis){ moveAxis.d.negate(); moveSync(); } });
$('moveDist').addEventListener('change', e => moveTyped(e.target.value));
$('btnMoveReset').addEventListener('click', ()=>{ if (selected){ selected.moved.set(0, 0, 0); applyExplode(); } });

function movePickStart(){
  if (!modelRoot){ toast('Load a model first'); return; }
  axisPickMode = true;
  if (!edgesOn) toggleEdges();       // an edge is easier to aim at when it is drawn
  $('btnAxisPick').classList.add('active');
  moveCursor(); moveSync();
}
function movePickCancel(){
  axisPickMode = false;
  $('btnAxisPick').classList.remove('active');
  moveCursor(); moveSync();
}
function moveReset(){                // a new model: no axis, nothing picked or held
  moveAxis = null; moveDrag = null; moveHover = false;
  if (explodeAxis === 'axis') setExplodeAxis('all');
  movePickCancel();
}
// The click after Pick axis… (pick() in 30-select.js sends it here): a face or edge, as Measure picks.
function pickAxis(e){
  const ent = entityAt(e), ax = ent && axisFrom(ent);
  if (!ax){ toast('No axis there — pick a straight edge, a circle, a cylinder or a flat face'); return; }
  moveAxis = ax;
  movePickCancel();
  selectPart(ent.part);
  if (explodeAxis === 'axis') applyExplode();
  moveSync();
}
function axisFrom(ent){
  const g = ent.geom, ax = axisOf(g);
  let p, d;
  if (ax){ p = g.type === 'circle' ? g.c : footOnLine(ent.hit, ax.p, ax.a); d = ax.a; }   // on the axis, by the pick
  else if (g.type === 'line'){ p = g.p0.clone().lerp(g.p1, 0.5); d = g.d; }
  else if (g.type === 'plane'){ p = ent.hit; d = g.n; }
  else return null;
  d = d.clone().normalize();
  if (d.dot(_ma.subVectors(ent.part.restCenter, modelCenter)) < 0) d.negate();   // + pulls the part out
  return {p:p.clone(), d, part:ent.part, geom:g, exact:!!ent.exact};
}
function axisName(a){                // named when shown, so it follows the units toggle; a figure off the mesh says so
  const g = a.geom, m = a.exact ? '' : ' (mesh)';
  switch (g.type){
    case 'cylinder': return 'cylinder Ø' + L(2*g.r) + MM() + m;
    case 'circle': return (g.closed ? 'circle Ø' + L(2*g.r) : 'arc R' + L(g.r)) + MM() + m;
    case 'line': return 'edge ' + L(g.len) + MM() + m;
    case 'plane': return 'face normal';
  }
  return g.type;                     // cone, torus
}

// The distance box: how far along the axis the part sits from its assembled place, in shown units
// -- its explode along the axis included, so the box always says where the part is.
function moveTyped(text){
  const v = parseFloat(String(text).replace(',', '.'));
  if (moveAxis && selected && Math.abs(v / unitScale) > 100 * modelSize) toast('Too far: more than 100 times the size of the model');
  else if (moveAxis && selected && Number.isFinite(v)){ moveTo(selected, v / unitScale); return; }
  moveSync();
}
function moveTo(part, v){            // put `part` v mesh units along the axis from its assembled place
  part.moved.addScaledVector(moveAxis.d, v - part.offset.dot(moveAxis.d));   // offset: explode + move, as last applied
  applyExplode();
}
const moveNum = v => String(+(v * unitScale).toFixed(unitsRaw ? 9 : 6));    // what was typed, not a rounding of it
function moveSync(){                 // the panel, after anything that changes the axis, the part or its move
  const p = moveAxis ? selected : null, box = $('moveDist');
  $('axisName').textContent = moveAxis ? axisName(moveAxis) : 'none';
  $('axisName').classList.toggle('none', !moveAxis);
  $('axisName').title = moveAxis ? axisName(moveAxis) : '';
  $('btnAxisFlip').disabled = !moveAxis;
  box.disabled = !p;
  box.value = p ? moveNum(p.offset.dot(moveAxis.d)) : '';
  $('moveUnit').textContent = unitsRaw ? '' : 'mm';
  $('btnMoveReset').disabled = !(selected && selected.moved.lengthSq() > 0);
  // textContent: a part name comes from the model file
  $('moveHint').textContent = axisPickMode ? 'Click a straight edge, a circle, a cylinder or a flat face.'
    : !moveAxis ? 'Pick an axis, then move a part along it: type the distance, or drag the arrow on the part.'
    : !p ? 'Click a part to move it along this axis.'
    : 'Moving ' + p.name + ': type how far along the axis it sits from its assembled place, or drag the arrow. + points out of the assembly.';
}

// ── The drag handle ──────────────────────────────────────────
// Drawn on the annotation canvas (live only: a screenshot shows neither it nor the axis), through
// the selected part's centre, square with the screen. Dragging it slides the part along the axis to
// where the cursor points, in round steps that suit the zoom.
function moveGizmoOn(){ return !!moveAxis && $('explodepanel').classList.contains('show'); }
function moveHandle(){               // CSS px on the canvas: centre c, screen direction u (null: the axis faces the eye)
  const p = selected;
  if (!moveGizmoOn() || !p || !p.visible) return null;
  const c = toScreen(p.restCenter, p, viewport.clientWidth, viewport.clientHeight);
  if (!c) return null;
  const at = _mb.copy(p.restCenter).add(p.offset), dist = camera.position.distanceTo(at);
  if (Math.abs(_ma.subVectors(at, camera.position).dot(moveAxis.d)) > MOVE_END_ON * dist) return {c, u:null};
  const e = toScreen(_ma.copy(p.restCenter).addScaledVector(moveAxis.d, dist * 0.01), p, viewport.clientWidth, viewport.clientHeight);
  const dx = e ? e.x - c.x : 0, dy = e ? e.y - c.y : 0, l = Math.hypot(dx, dy);
  return {c, u:l > 0 ? {x:dx / l, y:dy / l} : null};
}
function moveGrab(e){                // is the cursor on the handle?
  const h = !axisPickMode && moveHandle();
  if (!h || !h.u) return false;
  const r = canvas.getBoundingClientRect(), x = e.clientX - r.left - h.c.x, y = e.clientY - r.top - h.c.y;
  const t = Math.max(-MOVE_PX, Math.min(MOVE_PX, x * h.u.x + y * h.u.y));
  return Math.hypot(x - t * h.u.x, y - t * h.u.y) <= MOVE_GRAB;
}
// Where the cursor points along the axis through c, in mesh units from c: the point of that line
// nearest the cursor's ray. Null when the ray runs within 5° of the axis: there a pixel is a long
// way along it, and a drag toward the axis's vanishing point would throw the part off to infinity.
function axisParam(e, c){
  setRay(e);
  const r = raycaster.ray, d = moveAxis.d, b = r.direction.dot(d), den = 1 - b * b;
  if (Math.abs(b) > MOVE_END_ON) return null;
  _ma.subVectors(r.origin, c);
  return (_ma.dot(d) - b * _ma.dot(r.direction)) / den;
}
function moveStep(part){             // 1, 2 or 5 x 10^n shown units: the roundest step about 3 px long at the part
  const px = 2 * camera.position.distanceTo(_ma.copy(part.restCenter).add(part.offset)) *
             Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / (canvas.clientHeight || 1);
  const raw = Math.max(3 * px * unitScale, 1e-9), e = Math.pow(10, Math.floor(Math.log10(raw))), m = raw / e;
  return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * e / unitScale;
}
function moveCursor(){
  if (moveDrag) canvas.style.cursor = 'grabbing';
  else if (moveHover) canvas.style.cursor = 'grab';
  else if (axisPickMode) canvas.style.cursor = 'crosshair';
  else canvas.style.cursor = '';
}
// A drag holds the part by the point of the axis under the cursor. That axis line runs through the
// part's centre as it was when the drag began, fixed: measured from the moving centre instead, the
// part only ever caught up part of the way.
function moveDragBegin(e, part){
  const c = part.restCenter.clone().add(part.offset), t = axisParam(e, c);
  if (t === null) return false;
  moveDrag = {id:e.pointerId, part, c, t0:t, v0:part.offset.dot(moveAxis.d), step:moveStep(part)};
  return true;
}
function moveDragTo(e){
  const t = axisParam(e, moveDrag.c);
  if (t !== null) moveTo(moveDrag.part, Math.round((moveDrag.v0 + t - moveDrag.t0) / moveDrag.step) * moveDrag.step);
}
// Capture phase on the viewport: a grab never reaches the orbit, the controls or click-to-select.
viewport.addEventListener('pointerdown', e=>{
  if (e.target !== canvas || e.button !== 0 || !moveGrab(e) || !moveDragBegin(e, selected)) return;
  e.stopPropagation(); e.preventDefault();
  canvas.setPointerCapture(e.pointerId);
  $('moveDist').blur();               // prevented, the press would not take the focus off the box
  moveCursor();
}, true);
window.addEventListener('pointermove', e=>{
  if (moveDrag){ if (e.pointerId !== moveDrag.id) return; if (e.buttons) moveDragTo(e); else moveEnd(e); return; }
  const h = e.target === canvas && !e.buttons && moveGrab(e);
  if (h !== moveHover){ moveHover = h; moveCursor(); }
});
const moveEnd = e => { if (moveDrag && e.pointerId === moveDrag.id){ moveDrag = null; moveCursor(); } };
window.addEventListener('pointerup', moveEnd);
window.addEventListener('pointercancel', moveEnd);

// s: canvas pixels per CSS pixel. The axis runs through the feature it was picked on, and moves with
// it; the handle is outlined so it reads on any part, and while dragged it shows the distance.
function drawMoveGizmo(ctx, s){
  const W = annotCanvas.width, H = annotCanvas.height, a = moveAxis, hot = !!(moveHover || moveDrag);
  const col = whiteBg ? '#15803d' : '#5ad18f', halo = whiteBg ? 'rgba(255,255,255,.85)' : 'rgba(0,0,0,.6)';
  const p0 = toScreen(_ma.copy(a.p).addScaledVector(a.d, -modelSize), a.part, W, H);
  const p1 = toScreen(_mb.copy(a.p).addScaledVector(a.d, modelSize), a.part, W, H);
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  if (p0 && p1){
    ctx.strokeStyle = col; ctx.lineWidth = 1.3 * s; ctx.setLineDash([12*s, 4*s, 2*s, 4*s]);
    ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
  }
  ctx.setLineDash([]);
  const h = moveHandle();
  if (!h){ ctx.restore(); return; }
  const x = h.c.x * s, y = h.c.y * s, R = MOVE_PX * s, hd = 15 * s, w = 7 * s;
  const shape = (color, grow) => {                     // the halo pass, then the colour
    ctx.strokeStyle = ctx.fillStyle = color; ctx.lineWidth = ((hot ? 4.5 : 3) + grow) * s;
    if (h.u){
      const ux = h.u.x, uy = h.u.y;
      ctx.beginPath(); ctx.moveTo(x - ux*(R - hd), y - uy*(R - hd)); ctx.lineTo(x + ux*(R - hd), y + uy*(R - hd)); ctx.stroke();
      for (const k of [1, -1]){                        // a head at each end
        const tx = x + k*ux*R, ty = y + k*uy*R, bx = tx - k*ux*hd, by = ty - k*uy*hd;
        ctx.beginPath(); ctx.moveTo(tx, ty); ctx.lineTo(bx - uy*w, by + ux*w); ctx.lineTo(bx + uy*w, by - ux*w); ctx.closePath();
        ctx.fill(); if (grow) ctx.stroke();
      }
    } else { ctx.beginPath(); ctx.arc(x, y, 11 * s, 0, 2 * Math.PI); ctx.stroke(); }   // end-on: a ring
    ctx.beginPath(); ctx.arc(x, y, (4.5 + grow / 2) * s, 0, 2 * Math.PI); ctx.fill();
  };
  shape(halo, 3);
  shape(hot ? (whiteBg ? '#166534' : '#a7f3c4') : col, 0);
  if (h.u){                                            // "+" past the + end; the distance while dragged
    const v = selected.offset.dot(a.d), text = moveDrag ? (v > 0 ? '+' : '') + L(v) + MM() : '+';
    ctx.font = (moveDrag ? '' : 'bold ') + Math.round((moveDrag ? 11.5 : 15) * s) + 'px ' + ANNOT_FONT;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    const bw = ctx.measureText(text).width + 12 * s, bh = 19 * s, push = Math.abs(h.u.x) * bw / 2 + Math.abs(h.u.y) * bh / 2 + 4 * s;
    const lx = Math.min(Math.max(x + h.u.x * (R + push), bw / 2), W - bw / 2), ly = Math.min(Math.max(y + h.u.y * (R + push), bh / 2), H - bh / 2);
    if (moveDrag){
      ctx.fillStyle = 'rgba(17,19,24,.9)'; ctx.fillRect(lx - bw/2, ly - bh/2, bw, bh);
      ctx.strokeStyle = col; ctx.lineWidth = s; ctx.strokeRect(lx - bw/2, ly - bh/2, bw, bh);
      ctx.fillStyle = '#ffffff';
    } else { ctx.strokeStyle = halo; ctx.lineWidth = 3 * s; ctx.strokeText(text, lx, ly); ctx.fillStyle = col; }
    ctx.fillText(text, lx, ly + 0.5 * s);
  }
  ctx.restore();
}
