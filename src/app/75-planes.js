// ── Reference planes ─────────────────────────────────────────
// The three planes of the world frame, through the origin: YZ (normal X, red), ZX (normal Y, green) and
// XY (normal Z, blue), coloured as the axis triad (70-axes.js), and named by the standard views that look
// square at them (00-scene.js: Y up, +Z towards the viewer in Front): XY Front, ZX Top, YZ Left. Each name
// is a label at the plane's far corner that always faces the camera. Each is drawn as a translucent sheet with
// an outline, sized to cover the assembled model's outline on it and the origin, with a margin. They are
// in the scene, not in the model: not selected or measured, not cut (Normal to alone can click one), and not counted in the bounding box.
// Toolbar Planes or P shows or hides all three; they are rebuilt for every model. Normal to (48-views.js)
// can look square at one: a click on its sheet, planeHit() in 76-datum.js.
let planesOn = false, planeRoot = null;
const PLANES = [
  {name:'YZ', label:'Left',  n:0, u:1, v:2, color:0xd92d20},     // normal X
  {name:'ZX', label:'Top',   n:1, u:2, v:0, color:0x15803d},     // normal Y
  {name:'XY', label:'Front', n:2, u:0, v:1, color:0x1d4ed8}      // normal Z
];
const PLANE_LABEL_H = 0.06;          // a label's height, in model sizes
const PLANE_MARGIN = 0.1;            // each side reaches this share of the model size past what it covers
$('btnPlanes').addEventListener('click', togglePlanes);
function togglePlanes(){ setPlanes(!planesOn); }
function setPlanes(on){
  planesOn = on;
  $('btnPlanes').classList.toggle('active', on);
  $('btnPlanes').setAttribute('aria-pressed', on ? 'true' : 'false');
  if (on && !planeRoot) buildPlanes();
  if (planeRoot) planeRoot.visible = on;
}
// One plane's rectangle in world coordinates: its four corners, in order, on the plane through the origin.
function planeCorners(pl, box){
  const lo = [0, 0], hi = [0, 0], m = PLANE_MARGIN * modelSize;
  [pl.u, pl.v].forEach((k, j) => {
    lo[j] = Math.min(0, box ? box.min.getComponent(k) : -modelSize / 2) - m;
    hi[j] = Math.max(0, box ? box.max.getComponent(k) : modelSize / 2) + m;
  });
  return [[lo[0], lo[1]], [hi[0], lo[1]], [hi[0], hi[1]], [lo[0], hi[1]]].map(([a, b]) => {
    const c = new THREE.Vector3();
    c.setComponent(pl.u, a); c.setComponent(pl.v, b);
    return c;
  });
}
// A plane's translucent sheet and outline from its four corners. `normal` and `title` ride on the sheet
// for Normal to (48-views.js): what a click on it looks square at, and what the toast calls it.
function planeSheet(c, color, name, normal, title){
  const pos = [];
  [0, 1, 2, 0, 2, 3].forEach(i => pos.push(c[i].x, c[i].y, c[i].z));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const sheet = new THREE.Mesh(g, new THREE.MeshBasicMaterial({color, transparent:true, opacity:0.12,
    side:THREE.DoubleSide, depthWrite:false, polygonOffset:true, polygonOffsetFactor:1, polygonOffsetUnits:1}));
  sheet.renderOrder = 1;
  const lg = new THREE.BufferGeometry().setFromPoints(c.concat([c[0]]));
  const line = new THREE.Line(lg, new THREE.LineBasicMaterial({color, transparent:true, opacity:0.8}));
  sheet.userData.plane = line.userData.plane = name;
  sheet.userData.normal = normal; sheet.userData.title = title;
  return [sheet, line];
}
function buildPlanes(){
  planeRoot = new THREE.Group();
  planeRoot.name = 'reference planes';
  const box = bboxCached || computeBBox();
  PLANES.forEach(pl => {
    const c = planeCorners(pl, box);
    planeRoot.add(...planeSheet(c, pl.color, pl.name, new THREE.Vector3().setComponent(pl.n, 1),
                                pl.label + ' plane (' + pl.name + ')'));
    const tag = planeLabel(pl);
    if (tag){                        // inside the far corner, pulled a little towards the opposite one
      tag.position.copy(c[2]).lerp(c[0], 0.08);
      planeRoot.add(tag);
    }
  });
  planeRoot.visible = planesOn;
  scene.add(planeRoot);
}
// The plane's name drawn on a canvas, as a sprite: it turns to face the camera and zooms with the model.
// No label where there is no 2D canvas to draw it on (the test harness).
function planeLabel(pl){
  const cv = document.createElement('canvas'), ctx = cv.getContext && cv.getContext('2d');
  if (!ctx || !ctx.fillText || !ctx.measureText) return null;
  const px = 48, font = 'bold ' + px + 'px sans-serif';
  ctx.font = font;
  cv.width = Math.ceil(ctx.measureText(pl.label).width) + 16; cv.height = px + 16;
  ctx.font = font; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';     // a resize resets the context
  ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(255,255,255,.9)'; ctx.strokeText(pl.label, 8, cv.height / 2);
  ctx.fillStyle = '#' + pl.color.toString(16).padStart(6, '0'); ctx.fillText(pl.label, 8, cv.height / 2);
  const tex = new THREE.CanvasTexture(cv);
  tex.encoding = THREE.sRGBEncoding;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({map:tex, transparent:true, depthTest:false, depthWrite:false}));
  const h = PLANE_LABEL_H * modelSize;
  sp.scale.set(h * cv.width / cv.height, h, 1);
  sp.renderOrder = 2;
  sp.userData.plane = pl.name; sp.userData.label = pl.label;
  return sp;
}
function disposeNode(root){          // geometries, textures and materials of everything under root
  root.traverse(o => { if (o.geometry) o.geometry.dispose();
    if (o.material){ if (o.material.map) o.material.map.dispose(); o.material.dispose(); } });
}
function disposePlanes(){            // a new model: the planes are sized again when next shown
  if (!planeRoot) return;
  scene.remove(planeRoot);
  disposeNode(planeRoot);
  planeRoot = null;
}
