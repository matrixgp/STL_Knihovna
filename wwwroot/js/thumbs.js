// Náhledy projektů: obrázek ze složky → vložený náhled z 3MF → render STL (three.js). Výsledek se cachuje na serveru.
import { api } from './api.js';
import { stepToGroup } from './step.js';

const MAX_STL = 60 * 1024 * 1024;
const MAX_STEP = 25 * 1024 * 1024;
let serverKeys = new Set();
const pending = new Map();
let chain = Promise.resolve();

export async function initThumbs() {
  pending.clear();
  try { serverKeys = new Set(await api.thumbs()); } catch { serverKeys = new Set(); }
}

const hash = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0;
  return h.toString(16);
};
export const thumbKey = (f) => `${hash(f.path)}-${f.mtime.toString(16)}-${f.size.toString(16)}`;

export function pickSource(p) {
  if (p.images.length) {
    const pref = p.images.find((i) => /preview|featured|cover|render|main/i.test(i.name))
      || [...p.images].sort((a, b) => b.size - a.size)[0];
    return { type: 'image', file: pref };
  }
  const stls = p.models.filter((m) => m.ext === 'stl' && m.size <= MAX_STL).sort((a, b) => b.size - a.size);
  if (stls.length) return { type: 'stl', file: stls[0] };
  const m3 = p.models.find((m) => m.ext === '3mf');
  if (m3) return { type: '3mf', file: m3 };
  const stp = p.models.filter((m) => (m.ext === 'step' || m.ext === 'stp') && m.size <= MAX_STEP).sort((a, b) => b.size - a.size);
  if (stp.length) return { type: 'step', file: stp[0] };
  return null;
}

export function forgetThumb(id) { pending.delete(id); }

export function getThumb(p) {
  if (pending.has(p.id)) return pending.get(p.id);
  const src = pickSource(p);
  let prom;
  if (!src) prom = Promise.resolve(null);
  else if (src.type === 'image') prom = Promise.resolve(api.fileUrl(src.file.path));
  else {
    const key = thumbKey(src.file);
    if (serverKeys.has(key)) prom = Promise.resolve(api.thumbUrl(key));
    else {
      prom = new Promise((resolve) => {
        chain = chain.then(() => generate(src, key)).then(resolve, () => resolve(null));
      });
    }
  }
  pending.set(p.id, prom);
  return prom;
}

async function generate(src, key) {
  const res = await fetch(api.fileUrl(src.file.path));
  if (!res.ok) return null;
  const buf = await res.arrayBuffer();
  const blob = src.type === 'stl' ? await renderStl(buf) : src.type === 'step' ? await renderStep(buf) : await from3mf(buf);
  if (!blob) return null;
  api.putThumb(key, blob).then(() => serverKeys.add(key)).catch(() => {});
  return URL.createObjectURL(blob);
}

// ---- 3MF: vložený obrázek, jinak vykreslení geometrie ----------------------
export async function extract3mfThumb(buf) {
  const { unzipSync } = await import('three/addons/libs/fflate.module.js');
  const files = unzipSync(new Uint8Array(buf), { filter: (f) => /\.png$/i.test(f.name) && /metadata|thumbnail/i.test(f.name) });
  const names = Object.keys(files);
  const pick = names.find((n) => /plate_1\.png$/i.test(n))
    || names.find((n) => /thumbnail/i.test(n) && !/small/i.test(n))
    || names.find((n) => !/pick_|top_|small/i.test(n))
    || names[0];
  return pick ? new Blob([files[pick]], { type: 'image/png' }) : null;
}

async function from3mf(buf) {
  try {
    const png = await extract3mfThumb(buf);
    if (png) return png;
  } catch { /* poškozený archiv → zkusíme geometrii */ }
  try {
    const { material } = await getGL();
    const { ThreeMFLoader } = await import('three/addons/loaders/3MFLoader.js');
    const obj = new ThreeMFLoader().parse(buf);
    let meshes = 0;
    obj.traverse((o) => { if (o.isMesh) { meshes++; o.material = material; } });
    return meshes ? await renderObject(obj) : null;
  } catch { return null; }
}

// ---- render ---------------------------------------------------------------
let gl = null;
async function getGL() {
  if (gl) return gl;
  const THREE = await import('three');
  const { STLLoader } = await import('three/addons/loaders/STLLoader.js');
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(480, 360, false);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.1));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(1, -1.4, 2);
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xaaccff, 0.8);
  fill.position.set(-2, 1, 0.5);
  scene.add(fill);
  const camera = new THREE.PerspectiveCamera(30, 480 / 360, 0.1, 100000);
  camera.up.set(0, 0, 1);
  const material = new THREE.MeshStandardMaterial({ color: 0x9fd8bd, roughness: 0.55, metalness: 0.1, flatShading: true });
  gl = { THREE, STLLoader, renderer, scene, camera, material };
  return gl;
}

async function renderObject(obj) {
  const { THREE, renderer, scene, camera } = await getGL();
  const box = new THREE.Box3().setFromObject(obj);
  const c = box.getCenter(new THREE.Vector3());
  const r = box.getSize(new THREE.Vector3()).length() / 2 || 1;
  obj.position.sub(c);
  const holder = new THREE.Group();
  holder.add(obj);
  scene.add(holder);
  const dist = (r / Math.sin((camera.fov * Math.PI) / 360)) * 1.05;
  camera.position.set(1, -1.15, 0.85).normalize().multiplyScalar(dist);
  camera.lookAt(0, 0, 0);
  camera.near = dist / 100;
  camera.far = dist * 10;
  camera.updateProjectionMatrix();
  renderer.render(scene, camera);
  const blob = await new Promise((res) => renderer.domElement.toBlob(res, 'image/png'));
  scene.remove(holder);
  obj.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  return blob;
}

async function renderStep(buf) {
  const { THREE, material } = await getGL();
  const { group } = await stepToGroup(THREE, buf, material);
  return renderObject(group);
}

async function renderStl(buf) {
  const { THREE, STLLoader, material } = await getGL();
  const geom = new STLLoader().parse(buf);
  return renderObject(new THREE.Mesh(geom, material));
}
