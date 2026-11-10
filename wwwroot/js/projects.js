// Čistá logika: z plochého seznamu souborů složí projekty. Bez DOM, běží i v Node (testy).

export const MODEL_EXT = new Set(['stl', '3mf', 'step', 'stp', 'obj', 'f3d', 'f3z', 'fcstd', 'skp', 'scad', 'amf', 'ply', 'iges', 'igs']);
export const IMAGE_EXT = new Set(['jpg', 'jpeg', 'png', 'webp', 'gif', 'bmp']);
export const SOURCE_EXT = new Set(['fcstd', 'f3d', 'f3z', 'scad', 'py']);
const SUPPORT_DIRS = new Set(['files', 'images', 'image', 'img', 'imgs', 'photos', 'pictures', 'stl', 'stls', 'models', 'model', '3mf', 'gcode', 'gcodes', 'docs', 'doc', 'source', 'sources', 'src', 'cad', 'cura', 'slicer', 'renders', 'preview', 'previews', 'instructions']);
const JUNK_FILES = new Set(['desktop.ini', 'thumbs.db', '.ds_store']);
const JUNK_EXT = new Set(['fcbak', 'bak', 'tmp', 'lnk']);
const SEP = /[ _\-.+]/;

export const extOf = (name) => {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(i + 1).toLowerCase() : '';
};
const stemOf = (name) => {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
};
const isModel = (f) => MODEL_EXT.has(f.ext);
const lc = (s) => s.toLowerCase();
const strip = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

export function prettify(s) {
  return s.replace(/[_+]+/g, ' ').replace(/\s+/g, ' ').trim();
}

// ---- strom složek ---------------------------------------------------------
function buildTree(files, cfg) {
  const ignore = (cfg.ignore || []).map((p) => lc(p).replace(/\\/g, '/').replace(/\/+$/, ''));
  const root = { name: '', path: '', files: [], dirs: new Map() };
  for (const raw of files) {
    const rel = raw.p;
    const parts = rel.split('/');
    const name = parts[parts.length - 1];
    const dirs = parts.slice(0, -1);
    if (dirs.some((d) => d.startsWith('~') || d.startsWith('.'))) continue;
    if (JUNK_FILES.has(lc(name)) || JUNK_EXT.has(extOf(name)) || name.startsWith('~$')) continue;
    const low = lc(rel);
    if (ignore.some((p) => low === p || low.startsWith(p + '/'))) continue;
    const f = { path: rel, name, ext: extOf(name), size: raw.s || 0, mtime: raw.m || 0 };
    let node = root;
    let acc = '';
    for (const d of dirs) {
      acc = acc ? acc + '/' + d : d;
      if (!node.dirs.has(d)) node.dirs.set(d, { name: d, path: acc, files: [], dirs: new Map() });
      node = node.dirs.get(d);
    }
    node.files.push(f);
  }
  return root;
}

const allFiles = (node) => [...node.files, ...[...node.dirs.values()].flatMap(allFiles)];
const hasModels = (node) => allFiles(node).some(isModel);
const isSupportDir = (d) => SUPPORT_DIRS.has(lc(d.name));
const subProjectDirs = (node) => [...node.dirs.values()].filter((d) => !isSupportDir(d) && hasModels(d));

// ---- seskupení volných souborů podle názvu --------------------------------
export function groupLoose(files) {
  const items = files.map((f) => ({ f, stem: stemOf(f.name) }));
  items.sort((a, b) => a.stem.length - b.stem.length || a.stem.localeCompare(b.stem));
  const groups = [];
  for (const it of items) {
    const s = lc(it.stem);
    const g = groups.find((x) => s === x.lower || (s.startsWith(x.lower) && SEP.test(s[x.lower.length])));
    if (g) g.files.push(it.f);
    else groups.push({ key: it.stem, lower: s, files: [it.f] });
  }
  return groups.filter((g) => g.files.some(isModel));
}

// ---- stavba projektu ------------------------------------------------------
function makeProject({ id, kind, name, folder, files, cats }, cfg) {
  const exts = {};
  for (const f of files) if (!IMAGE_EXT.has(f.ext) && f.ext) exts[f.ext] = (exts[f.ext] || 0) + 1;
  const images = files.filter((f) => IMAGE_EXT.has(f.ext));
  const models = files.filter(isModel);
  const mtime = Math.max(0, ...files.map((f) => f.mtime));
  const lowFolder = lc(folder);
  const inDownloaded = (cfg.downloadedFolders || []).some((p) => {
    const q = lc(p).replace(/\\/g, '/').replace(/\/+$/, '');
    return lowFolder === q || lowFolder.startsWith(q + '/') || lc(files[0].path).startsWith(q + '/');
  });
  const hasPreview = images.some((i) => /preview|featured/i.test(i.name));
  const hasSource = Object.keys(exts).some((e) => SOURCE_EXT.has(e));
  const hiddenCats = new Set((cfg.downloadedFolders || []).map((p) => lc(p.split('/').pop())));
  const catTags = cats.filter((c) => !hiddenCats.has(lc(c))).map(prettify);

  const hay = strip(name + ' ' + folder);
  const auto = [];
  for (const [tag, words] of Object.entries(cfg.autoTags || {})) {
    if (words.some((w) => hay.includes(strip(w)))) auto.push(tag);
  }
  const autoTags = [...new Set([...catTags, ...auto])];

  return {
    id, kind, name: prettify(name), folder, files, models, images, exts,
    mtime, size: files.reduce((a, f) => a + f.size, 0),
    cats, autoTags,
    autoOrigin: inDownloaded || hasPreview ? 'downloaded' : hasSource ? 'own' : 'unknown'
  };
}

export function buildProjects(files, cfg = {}) {
  const root = buildTree(files, cfg);
  const forced = new Set((cfg.collections || []).map((p) => lc(p).replace(/\\/g, '/').replace(/\/+$/, '')));
  const out = [];

  function walk(node, cats, isRoot) {
    const direct = node.files.filter(isModel).length;
    const subs = subProjectDirs(node);
    const collection = isRoot || forced.has(lc(node.path)) || (direct > 0 && subs.length > 0);

    if (!collection) {
      if (subs.length === 0) {
        if (hasModels(node)) {
          out.push(makeProject({ id: 'd:' + node.path, kind: 'folder', name: node.name, folder: node.path, files: allFiles(node), cats }, cfg));
        }
        return;
      }
      // kategorie: bez vlastních modelů, uvnitř jsou projekty
      for (const s of subs) walk(s, [...cats, node.name], false);
      return;
    }

    const myCats = isRoot ? cats : [...cats, node.name];
    for (const g of groupLoose(node.files)) {
      out.push(makeProject({
        id: 'g:' + (node.path ? node.path + '/' : '') + g.key, kind: 'group', name: g.key,
        folder: node.path, files: g.files, cats: myCats
      }, cfg));
    }
    for (const s of subs) walk(s, myCats, false);
  }

  walk(root, [], true);
  return out;
}
