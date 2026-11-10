// Převod STEP/STP na three.js geometrii pomocí occt-import-js (OpenCascade ve WebAssembly, lokální kopie).
let occtPromise = null;

function loadOcct() {
  if (!occtPromise) {
    occtPromise = new Promise((resolve, reject) => {
      const done = () => window.occtimportjs({ locateFile: (name) => '/lib/occt-import-js/' + name }).then(resolve, reject);
      if (window.occtimportjs) return done();
      const s = document.createElement('script');
      s.src = '/lib/occt-import-js/occt-import-js.js';
      s.onload = done;
      s.onerror = () => reject(new Error('Nepodařilo se načíst knihovnu pro STEP'));
      document.head.appendChild(s);
    }).catch((e) => { occtPromise = null; throw e; });
  }
  return occtPromise;
}

// Vrací { group, tris }. Všechny části dostanou stejný materiál.
export async function stepToGroup(THREE, buf, material) {
  const occt = await loadOcct();
  const r = occt.ReadStepFile(new Uint8Array(buf), null);
  if (!r || !r.success || !r.meshes || !r.meshes.length) throw new Error('STEP soubor se nepodařilo převést na model');
  const group = new THREE.Group();
  let tris = 0;
  for (const m of r.meshes) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(m.attributes.position.array, 3));
    if (m.attributes.normal) g.setAttribute('normal', new THREE.Float32BufferAttribute(m.attributes.normal.array, 3));
    g.setIndex(new THREE.Uint32BufferAttribute(m.index.array, 1));
    if (!m.attributes.normal) g.computeVertexNormals();
    tris += m.index.array.length / 3;
    group.add(new THREE.Mesh(g, material));
  }
  return { group, tris };
}
