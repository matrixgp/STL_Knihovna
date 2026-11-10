// 3D prohlížeč pro detail projektu (STL + 3MF), osa Z nahoře, podložka podle rozměrů tiskárny.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { stepToGroup } from './step.js';

export class Viewer {
  constructor(el, bed = [256, 256, 256]) {
    this.el = el;
    this.bed = bed;
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    el.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 20000);
    this.camera.up.set(0, 0, 1);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x445566, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(200, -300, 400);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xaaccff, 0.8);
    fill.position.set(-300, 200, 100);
    this.scene.add(fill);

    const size = Math.max(bed[0], bed[1]);
    const grid = new THREE.GridHelper(size, Math.round(size / 10), 0x4a5568, 0x2a303b);
    grid.rotation.x = Math.PI / 2;
    grid.material.transparent = true;
    grid.material.opacity = 0.55;
    this.scene.add(grid);
    const outline = new THREE.LineSegments(
      new THREE.EdgesGeometry(new THREE.PlaneGeometry(bed[0], bed[1])),
      new THREE.LineBasicMaterial({ color: 0x2fd27b })
    );
    this.scene.add(outline);

    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;

    this.model = null;
    this._ro = new ResizeObserver(() => this.resize());
    this._ro.observe(el);
    this.resize();
    this._loop = () => {
      this._raf = requestAnimationFrame(this._loop);
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
    };
    this._loop();
  }

  resize() {
    const w = Math.max(1, this.el.clientWidth);
    const h = Math.max(1, this.el.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = w + 'px';
    this.renderer.domElement.style.height = h + 'px';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  clear() {
    if (!this.model) return;
    this.scene.remove(this.model);
    this.model.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m.dispose());
    });
    this.model = null;
  }

  // Vrací { dims:[x,y,z], tris, fits }
  async load(url, ext) {
    const res = await fetch(url);
    if (!res.ok) throw new Error('Soubor se nepodařilo načíst (' + res.status + ')');
    const buf = await res.arrayBuffer();
    let obj;
    let tris = 0;
    if (ext === '3mf') {
      const { ThreeMFLoader } = await import('three/addons/loaders/3MFLoader.js');
      obj = new ThreeMFLoader().parse(buf);
      obj.traverse((o) => {
        if (o.isMesh) {
          tris += o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
          o.material = new THREE.MeshStandardMaterial({ color: 0x9fd8bd, roughness: 0.55, metalness: 0.1 });
        }
      });
    } else if (ext === 'step' || ext === 'stp') {
      const r = await stepToGroup(THREE, buf, new THREE.MeshStandardMaterial({ color: 0x9fd8bd, roughness: 0.55, metalness: 0.1 }));
      obj = r.group;
      tris = r.tris;
    } else {
      const geom = new STLLoader().parse(buf);
      tris = geom.attributes.position.count / 3;
      obj = new THREE.Mesh(geom, new THREE.MeshStandardMaterial({ color: 0x9fd8bd, roughness: 0.55, metalness: 0.1, flatShading: true }));
    }
    if (tris === 0) throw new Error('Soubor neobsahuje žádnou geometrii');

    this.clear();
    const box = new THREE.Box3().setFromObject(obj);
    const size = box.getSize(new THREE.Vector3());
    const c = box.getCenter(new THREE.Vector3());
    obj.position.set(-c.x, -c.y, -box.min.z); // na střed podložky, spodek na Z=0
    const holder = new THREE.Group();
    holder.add(obj);
    this.scene.add(holder);
    this.model = holder;

    const r = Math.max(size.x, size.y, size.z) * 0.9 + 5;
    const dist = r / Math.sin((this.camera.fov * Math.PI) / 360);
    this.controls.target.set(0, 0, size.z / 2);
    this.camera.position.set(1, -1.15, 0.8).normalize().multiplyScalar(dist).add(this.controls.target);
    this.camera.near = Math.max(0.1, dist / 200);
    this.camera.far = dist * 40 + 2000;
    this.camera.updateProjectionMatrix();
    this.controls.update();

    const fits = size.x <= this.bed[0] && size.y <= this.bed[1] && size.z <= this.bed[2];
    return { dims: [size.x, size.y, size.z], tris: Math.round(tris), fits };
  }

  dispose() {
    cancelAnimationFrame(this._raf);
    this._ro.disconnect();
    this.clear();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
