const $ = id => document.getElementById(id);
const canvas = $('canvas3d'), viewport = $('viewport');

// ── Renderer / scene ─────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({canvas, antialias:true, preserveDrawingBuffer:true, stencil:true});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputEncoding = THREE.sRGBEncoding;
renderer.localClippingEnabled = true;

const scene = new THREE.Scene();
const DARK_BG = 0x191c21, LIGHT_BG = 0xffffff;
let whiteBg = false;
scene.background = new THREE.Color(DARK_BG);

const camera = new THREE.PerspectiveCamera(45, 1, 0.001, 1e6);
camera.position.set(1,1,1);

const controls = new THREE.OrbitControls(camera, canvas);
controls.enableDamping = true;
controls.dampingFactor = 0.12;
controls.screenSpacePanning = true;

scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 0.9));
const key = new THREE.DirectionalLight(0xffffff, 0.85); key.position.set(1, 1.4, 0.8); scene.add(key);
const fill = new THREE.DirectionalLight(0xffffff, 0.3); fill.position.set(-1, -0.4, -0.7); scene.add(fill);

let modelRoot = null, edgeRoot = null, edgesOn = false;
// Mesh units: OpenCASCADE writes glTF in metres whatever the STEP was authored in,
// so lengths are shown as mm = mesh units x 1000. STL carries no units; assume mm.
let unitScale = 1000;
const L  = v => fmt(v * unitScale);            // length -> mm
const A2 = v => fmt(v * unitScale * unitScale); // area  -> mm2
let parts = [], bboxCached = null, modelSize = 1, modelCenter = new THREE.Vector3();

function resize(){
  const w = viewport.clientWidth, h = viewport.clientHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h; camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe(viewport);
resize();
renderer.setAnimationLoop(()=>{ controls.update(); renderer.render(scene, camera); });

// ── Framing ──────────────────────────────────────────────────
function computeBBox(){
  const box = new THREE.Box3();
  if (modelRoot) box.expandByObject(modelRoot);
  return box.isEmpty() ? null : box;
}
function frame(dir){
  const box = bboxCached || computeBBox();
  if (!box) return;
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z);
  const dist = maxDim / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov)/2)) * 1.35;
  const d = (dir || new THREE.Vector3(1, 0.75, 1)).clone().normalize();
  camera.position.copy(center).addScaledVector(d, dist);
  camera.near = Math.max(dist/1000, 1e-4);
  camera.far  = dist * 100;
  camera.updateProjectionMatrix();
  controls.target.copy(center); controls.update();
}
const VIEWS = {
  iso:new THREE.Vector3(1,.8,1), front:new THREE.Vector3(0,0,1),
  top:new THREE.Vector3(0,1,.0001), right:new THREE.Vector3(1,0,0)
};
document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', ()=> frame(VIEWS[b.dataset.view])));
$('btnFit').addEventListener('click', ()=> frame());

