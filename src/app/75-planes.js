// ── Reference planes ─────────────────────────────────────────
// The three planes of the world frame, through the origin: YZ (normal X, red), ZX (normal Y, green) and
// XY (normal Z, blue), coloured as the axis triad (70-axes.js). Each is drawn as a translucent sheet with
// an outline, sized to cover the assembled model's outline on it and the origin, with a margin. They are
// in the scene, not in the model: not picked, not measured, not cut, and not counted in the bounding box.
// Toolbar Planes or P shows or hides all three; they are rebuilt for every model.
let planesOn = false, planeRoot = null;
const PLANES = [
  {name:'YZ', n:0, u:1, v:2, color:0xd92d20},     // normal X
  {name:'ZX', n:1, u:2, v:0, color:0x15803d},     // normal Y
  {name:'XY', n:2, u:0, v:1, color:0x1d4ed8}      // normal Z
];
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
function buildPlanes(){
  planeRoot = new THREE.Group();
  planeRoot.name = 'reference planes';
  const box = bboxCached || computeBBox();
  PLANES.forEach(pl => {
    const c = planeCorners(pl, box), pos = [];
    [0, 1, 2, 0, 2, 3].forEach(i => pos.push(c[i].x, c[i].y, c[i].z));
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const sheet = new THREE.Mesh(g, new THREE.MeshBasicMaterial({color:pl.color, transparent:true, opacity:0.12,
      side:THREE.DoubleSide, depthWrite:false, polygonOffset:true, polygonOffsetFactor:1, polygonOffsetUnits:1}));
    sheet.renderOrder = 1;
    const lg = new THREE.BufferGeometry().setFromPoints(c.concat([c[0]]));
    const line = new THREE.Line(lg, new THREE.LineBasicMaterial({color:pl.color, transparent:true, opacity:0.8}));
    sheet.userData.plane = line.userData.plane = pl.name;
    planeRoot.add(sheet, line);
  });
  planeRoot.visible = planesOn;
  scene.add(planeRoot);
}
function disposePlanes(){            // a new model: the planes are sized again when next shown
  if (!planeRoot) return;
  scene.remove(planeRoot);
  planeRoot.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  planeRoot = null;
}
