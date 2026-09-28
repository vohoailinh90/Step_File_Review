// ── Measurement annotations ──────────────────────────────────
// Drawn on a 2D canvas over the 3D view each frame, and burnt into screenshots. Every point
// is kept in assembled coordinates together with its part, so dimensions ride along with the
// parts in an exploded view.
const ANNOT_FONT = '"Cascadia Code", Consolas, "JetBrains Mono", ui-monospace, monospace';
const _sv = new THREE.Vector3();
let annotShown = false;
function annotItems(){ return keptItems.concat(measItems); }
function drawAnnotLive(){
  const items = annotItems();
  if (!items.length && !annotShown) return;
  annotCtx.setTransform(1, 0, 0, 1, 0, 0);
  annotCtx.clearRect(0, 0, annotCanvas.width, annotCanvas.height);
  annotShown = items.length > 0;
  if (annotShown) drawAnnotations(annotCtx, annotCanvas.width, annotCanvas.height, annotCanvas.width / (viewport.clientWidth || 1), items);
}
function toScreen(p, part, W, H){
  _sv.copy(p);
  if (part) _sv.add(part.offset);
  _sv.applyMatrix4(camera.matrixWorldInverse);
  if (_sv.z > -camera.near) return null;               // behind the camera
  _sv.applyMatrix4(camera.projectionMatrix);
  return {x:(_sv.x + 1) / 2 * W, y:(1 - _sv.y) / 2 * H};
}
function dimText(it){
  const a = it.a.part, b = it.b && it.b.part;
  const split = a && b && a !== b && !a.offset.equals(b.offset);      // parts drawn apart, value is assembled
  return (it.text || (it.prefix || '') + (it.area ? A2(it.value) + MM2() : L(it.value) + MM())) + (split ? ' (assembled)' : '');
}
// s: canvas pixels per CSS pixel, so lines and text keep their size in hi-res screenshots
function drawAnnotations(ctx, W, H, s, items){
  const dimCol = whiteBg ? '#c2410c' : '#ffb454', axisCol = whiteBg ? '#2563eb' : '#5aa7e8', labels = [];
  const th = 19 * s;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.font = Math.round(11.5 * s) + 'px ' + ANNOT_FONT;
  for (const it of items){
    if (it.type === 'edge'){                          // a picked edge, drawn thick
      ctx.strokeStyle = it.color; ctx.lineWidth = 3 * s; ctx.setLineDash([]);
      ctx.beginPath();
      let pen = false, first = null;
      for (const p of it.pts){
        const q = toScreen(p, it.part, W, H);
        if (!q){ pen = false; continue; }
        if (pen) ctx.lineTo(q.x, q.y); else { ctx.moveTo(q.x, q.y); pen = true; }
        if (!first) first = q;
      }
      if (it.closed && pen && first) ctx.lineTo(first.x, first.y);
      ctx.stroke();
      continue;
    }
    const a = toScreen(it.a.p, it.a.part, W, H);
    if (it.type === 'tag'){ if (a) labels.push({x:a.x, y:a.y, text:dimText(it)}); continue; }
    const b = toScreen(it.b.p, it.b.part, W, H);
    if (!a || !b) continue;
    if (it.type === 'center'){                        // centre line of an axis
      ctx.strokeStyle = axisCol; ctx.lineWidth = 1.2 * s; ctx.setLineDash([10*s, 4*s, 2*s, 4*s]);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      continue;
    }
    const text = dimText(it), tw = ctx.measureText(text).width + 12 * s, len = Math.hypot(b.x - a.x, b.y - a.y);
    const ux = len > 1 ? (b.x - a.x) / len : 1, uy = len > 1 ? (b.y - a.y) / len : 0;
    let lx = (a.x + b.x) / 2, ly = (a.y + b.y) / 2;
    if (len < tw + 16 * s){                         // too short to hold its value: label just past the end
      const push = Math.abs(ux) * tw / 2 + Math.abs(uy) * th / 2 + 8 * s;
      lx = b.x + ux * push; ly = b.y + uy * push;
    }
    ctx.strokeStyle = ctx.fillStyle = dimCol; ctx.lineWidth = 1.6 * s; ctx.setLineDash([]);
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.lineTo(lx, ly); ctx.stroke();
    if (len > 1){
      const hd = Math.min(9 * s, len / 3), w = hd * 0.35;
      const arrow = (x, y, dx, dy) => {
        ctx.beginPath(); ctx.moveTo(x, y);
        ctx.lineTo(x - dx*hd - dy*w, y - dy*hd + dx*w); ctx.lineTo(x - dx*hd + dy*w, y - dy*hd - dx*w);
        ctx.closePath(); ctx.fill();
      };
      arrow(b.x, b.y, ux, uy);
      if (!it.single) arrow(a.x, a.y, -ux, -uy);
    }
    labels.push({x:lx, y:ly, text});
  }
  ctx.setLineDash([]);
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const l of labels){
    const w = ctx.measureText(l.text).width + 12 * s, h = th, r = 3 * s;
    const x = Math.min(Math.max(l.x, w/2 + 2*s), W - w/2 - 2*s), y = Math.min(Math.max(l.y, h/2 + 2*s), H - h/2 - 2*s);
    const x0 = x - w/2, y0 = y - h/2;
    ctx.beginPath();
    ctx.moveTo(x0 + r, y0); ctx.arcTo(x0 + w, y0, x0 + w, y0 + h, r); ctx.arcTo(x0 + w, y0 + h, x0, y0 + h, r);
    ctx.arcTo(x0, y0 + h, x0, y0, r); ctx.arcTo(x0, y0, x0 + w, y0, r); ctx.closePath();
    ctx.fillStyle = 'rgba(17,19,24,.9)'; ctx.fill();
    ctx.strokeStyle = dimCol; ctx.lineWidth = s; ctx.stroke();
    ctx.fillStyle = '#ffffff'; ctx.fillText(l.text, x, y + 0.5 * s);
  }
  ctx.restore();
}

