// ── Axis triad ───────────────────────────────────────────────
// X (red), Y (green), Z (blue) of the world, drawn in the lower-left corner of the view on a canvas of its
// own, so it turns with the camera but is not part of a screenshot. World axes: the model is not moved.
const axesCanvas = $('axes');
const AXES = [
  {name:'X', v:new THREE.Vector3(1, 0, 0), color:'#ff3b30'},
  {name:'Y', v:new THREE.Vector3(0, 1, 0), color:'#34d13c'},
  {name:'Z', v:new THREE.Vector3(0, 0, 1), color:'#2f6bff'}
];
const _aq = new THREE.Quaternion(), _av = new THREE.Vector3();
function drawAxes(){
  if (!axesCanvas || !axesCanvas.getContext) return;
  const ctx = axesCanvas.getContext('2d');
  if (!ctx || !ctx.clearRect) return;
  const css = axesCanvas.clientWidth || 110, dpr = renderer.getPixelRatio();
  if (axesCanvas.width !== Math.round(css * dpr)){ axesCanvas.width = axesCanvas.height = Math.round(css * dpr); }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, css, css);
  // The origin is the canvas centre: an axis can point any way, and its letter, 9 px past the tip and about
  // 7 px tall, must stay inside on every side (len + 9 + 7 < css / 2).
  const o = css / 2, len = css * 0.32;
  _aq.copy(camera.quaternion).invert();                      // world -> camera orientation
  const pts = AXES.map(a => {
    _av.copy(a.v).applyQuaternion(_aq);                      // x right, y up, z toward the viewer
    return {a, x:o + _av.x * len, y:o - _av.y * len, z:_av.z};
  }).sort((p, q) => p.z - q.z);                              // far axes first, so near ones draw over them
  ctx.lineWidth = 2; ctx.lineCap = 'round'; ctx.font = 'bold 13px sans-serif';
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const p of pts){
    ctx.strokeStyle = ctx.fillStyle = p.a.color;
    ctx.beginPath(); ctx.moveTo(o, o); ctx.lineTo(p.x, p.y); ctx.stroke();
    const dx = p.x - o, dy = p.y - o, d = Math.hypot(dx, dy) || 1;
    ctx.fillText(p.a.name, p.x + dx / d * 9, p.y + dy / d * 9);   // the letter sits just past the tip
  }
}
