import { api } from './api.js';
import { buildProjects } from './projects.js';
import { initThumbs, getThumb, pickSource, forgetThumb } from './thumbs.js';

// ---------------------------------------------------------------- helpers
const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const hueOf = (s) => { let h = 7; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360; return h; };
const fmtDate = (ms) => (ms ? new Date(ms).toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric', year: 'numeric' }) : '–');
const fmtSize = (b) => (b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toLocaleString('cs-CZ', { maximumFractionDigits: 1 }) + ' kB' : (b / 1048576).toLocaleString('cs-CZ', { maximumFractionDigits: 1 }) + ' MB');
const plural = (n, [a, b, c]) => (n === 1 ? a : n >= 2 && n <= 4 ? b : c);
const ORDER = ['stl', '3mf', 'step', 'stp', 'f3d', 'f3z', 'fcstd', 'skp', 'scad', 'obj', 'gcode', 'svg', 'dxf', 'py'];
const rank = (x) => { const i = ORDER.indexOf(x); return i < 0 ? 99 : i; };
const extSort = (a, b) => rank(a) - rank(b) || a.localeCompare(b);
const exts = (p) => Object.keys(p.exts).sort(extSort);
const EXT_COLORS = { stl: ['#1d3a30', '#6fe0a8'], '3mf': ['#1d3a30', '#6fe0a8'], step: ['#1f2f45', '#7fb8ff'], stp: ['#1f2f45', '#7fb8ff'], f3d: ['#3a2a1d', '#ffb07a'], f3z: ['#3a2a1d', '#ffb07a'], fcstd: ['#3a1f2f', '#ff8fc0'], py: ['#3a3320', '#ffd45e'], gcode: ['#2a2540', '#b9a6ff'] };

const ICON = {
  cube: (s = 20, c = 'currentColor') => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="${c}" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z"/><path d="M12 12l8-4.5M12 12v9M12 12L4 7.5"/></svg>`,
  search: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9aa3b2" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
  folder: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#9aa3b2" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  back: '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#e8eaee" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>',
  heart: (on, size = 16) => `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${on ? 'var(--accent)' : 'none'}" stroke="${on ? 'var(--accent)' : '#e8eaee'}" stroke-width="2" stroke-linejoin="round" aria-hidden="true"><path d="M12 21s-8-5.2-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 10c0 5.8-8 11-8 11z"/></svg>`,
  edit: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>'
};
const ORIGINS = { own: ['Vlastní', 'var(--accent)'], downloaded: ['Stažené', 'var(--amber)'], unknown: ['Neurčeno', '#9aa3b2'] };

// ---------------------------------------------------------------- stav
let savedAll = false;
try { savedAll = !!localStorage.getItem('stl.allTags'); } catch { /* ignore */ }
const S = {
  lib: null, cfg: {}, projects: [], byId: new Map(), meta: {},
  f: { q: '', coll: 'all', origin: 'all', tag: null, fmts: new Set() },
  sort: 'new', allTags: savedAll, viewer: null, scrollY: 0, sel: null, showTok: 0,
  panel: 'project', fsel: null, detailId: null, pendingSel: null
};

function eff(p) {
  const m = S.meta[p.id] || {};
  const userTags = m.tags || [];
  return {
    title: m.title || p.name,
    origin: m.origin || p.autoOrigin,
    originSet: !!m.origin,
    fav: !!m.fav,
    status: m.status || '',
    notes: m.notes || '',
    userTags,
    tags: [...new Set([...p.autoTags, ...userTags])]
  };
}

// ---- panel detailu souboru (metadata souboru mají klíč "f:<cesta>")
const fkey = (path) => 'f:' + path;
const baseName = (path) => path.split('/').pop();
function feff(p, f) {
  const m = S.meta[fkey(f.path)] || {};
  const pe = eff(p);
  const userTags = m.tags || [];
  return {
    title: baseName(f.path),
    origin: m.origin || pe.origin,
    originSet: !!m.origin,
    fav: !!m.fav,
    status: m.status || '',
    notes: m.notes || '',
    userTags,
    tags: [...new Set([...pe.tags, ...userTags])]
  };
}
const curFile = (p) => (S.panel === 'file' && p ? p.files.find((f) => f.path === S.fsel) || null : null);
const teff = (p) => { const f = curFile(p); return f ? feff(p, f) : eff(p); };
const tid = (p) => (curFile(p) ? fkey(S.fsel) : p.id);
const selPath = () => (S.panel === 'file' && S.fsel ? S.fsel : S.sel);

let saveT = null;
let dirty = false;
function updateMeta(id, patch) {
  const m = { ...(S.meta[id] || {}), ...patch };
  for (const k of Object.keys(m)) {
    const v = m[k];
    if (v === '' || v == null || v === false || (Array.isArray(v) && !v.length)) delete m[k];
  }
  if (Object.keys(m).length) S.meta[id] = m; else delete S.meta[id];
  dirty = true;
  clearTimeout(saveT);
  saveT = setTimeout(flushMeta, 350);
}
function flushMeta() {
  if (!dirty) return;
  dirty = false;
  api.saveMeta(S.meta).catch((e) => { dirty = true; toast('Uložení se nepovedlo: ' + e.message, true); });
}
window.addEventListener('pagehide', () => {
  if (dirty) fetch('/api/meta', { method: 'PUT', headers: { 'X-STL': '1', 'Content-Type': 'application/json' }, body: JSON.stringify(S.meta), keepalive: true });
});

function toast(msg, err = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { t.className = 'toast'; }, 3000);
}

// ---------------------------------------------------------------- data
async function loadAll(rescan = false) {
  const [lib, meta] = await Promise.all([api.library(), rescan ? Promise.resolve(S.meta) : api.meta()]);
  S.lib = lib;
  S.cfg = lib.config || {};
  S.meta = meta || {};
  S.projects = buildProjects(lib.files, S.cfg);
  S.byId = new Map(S.projects.map((p) => [p.id, p]));
  for (const p of S.projects) p._files = norm(p.files.map((f) => f.name).join(' ') + ' ' + p.folder);
}

function visible() {
  const words = norm(S.f.q).split(/\s+/).filter(Boolean);
  const rows = S.projects.map((p) => ({ p, e: eff(p) })).filter(({ p, e }) => {
    if (S.f.coll === 'fav' && !e.fav) return false;
    if (S.f.coll === 'toprint' && e.status !== 'toprint') return false;
    if (S.f.coll === 'printed' && e.status !== 'printed') return false;
    if (S.f.origin !== 'all' && e.origin !== S.f.origin) return false;
    if (S.f.tag && !e.tags.includes(S.f.tag)) return false;
    if (S.f.fmts.size && !exts(p).some((x) => S.f.fmts.has(x))) return false;
    if (words.length) {
      const hay = norm(e.title + ' ' + p.name + ' ' + e.tags.join(' ')) + ' ' + p._files;
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });
  const cmp = {
    new: (a, b) => b.p.mtime - a.p.mtime,
    old: (a, b) => a.p.mtime - b.p.mtime,
    name: (a, b) => a.e.title.localeCompare(b.e.title, 'cs'),
    big: (a, b) => b.p.size - a.p.size
  }[S.sort];
  return rows.sort(cmp);
}

// ---------------------------------------------------------------- shell
function renderShell() {
  $('#app').innerHTML = `
  <div class="page">
    <header class="topbar">
      <a class="brand" href="#/" aria-label="STL Knihovna – přehled">
        <span class="logo">${ICON.cube(22, '#06140c')}</span>STL Knihovna
      </a>
      <label class="search">${ICON.search}<input id="q" type="search" aria-label="Hledat v projektech" placeholder="Hledat projekt, soubor nebo štítek…  ( / )" autocomplete="off"></label>
      <div class="spacer"></div>
      <button class="pathchip" data-act="root-dialog" title="Změnit složku s modely" aria-label="Složka s modely: ${esc(S.lib.root)}. Změnit.">${ICON.folder}<span class="ptxt">${esc(S.lib.root)}</span><span class="chg">Změnit</span></button>
      <button class="btn" data-act="rescan">Znovu prohledat</button>
    </header>
    <div id="content"></div>
    <footer class="footer" id="foot"></footer>
  </div>`;
  $('#q').value = S.f.q;
  $('#q').addEventListener('input', (e) => {
    S.f.q = e.target.value;
    if (!location.hash.startsWith('#/p/')) { renderSide(); renderMain(); } else location.hash = '#/';
  });
}
function renderFoot(shown) {
  const n = S.projects.length;
  $('#foot').innerHTML = `<span>${n} ${plural(n, ['projekt', 'projekty', 'projektů'])} · ${esc(S.lib.root)}</span><span>${S.lib.files.length} souborů${shown != null && shown !== n ? ' · zobrazeno ' + shown : ''}${S.lib.version && S.lib.version !== 'dev' ? ` · v${esc(S.lib.version)}` : ''}</span>`;
}

// ---------------------------------------------------------------- knihovna
function renderLibrary() {
  $('#content').innerHTML = `<div class="layout"><aside class="side" id="side" aria-label="Filtry"></aside><main class="main" id="main"></main></div>`;
  renderSide();
  renderMain();
  window.scrollTo(0, S.scrollY || 0);
}

function navBtn(act, v, label, n, active, dot) {
  return `<button class="navbtn${active ? ' active' : ''}" data-act="${act}" data-v="${esc(v)}" aria-pressed="${active}"><span class="lbl">${dot ? `<span class="dot" style="background:${dot}"></span>` : ''}${esc(label)}</span><span class="n">${n}</span></button>`;
}

function renderSide() {
  const rows = S.projects.map((p) => ({ p, e: eff(p) }));
  const cnt = (fn) => rows.filter(fn).length;
  const colls = [
    ['all', 'Všechny projekty', rows.length], ['fav', 'Oblíbené', cnt((r) => r.e.fav)],
    ['toprint', 'K tisku', cnt((r) => r.e.status === 'toprint')], ['printed', 'Vytištěno', cnt((r) => r.e.status === 'printed')]
  ];
  const tagMap = new Map();
  for (const { e } of rows) for (const t of e.tags) tagMap.set(t, (tagMap.get(t) || 0) + 1);
  let tags = [...tagMap].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'cs'));
  const TOP_TAGS = 8;
  const allTagsN = tags.length;
  const hiddenTags = allTagsN - TOP_TAGS;
  if (!S.allTags) tags = tags.slice(0, TOP_TAGS);
  if (S.f.tag && !tags.some(([t]) => t === S.f.tag)) tags.push([S.f.tag, tagMap.get(S.f.tag) || 0]);
  const fmtMap = new Map();
  for (const p of S.projects) for (const x of exts(p)) fmtMap.set(x, (fmtMap.get(x) || 0) + 1);
  const fmts = [...fmtMap].sort((a, b) => b[1] - a[1]).sort((a, b) => extSort(a[0], b[0]));

  $('#side').innerHTML = `
    <nav class="navsec" aria-label="Kolekce"><div class="navtitle">Kolekce</div>
      ${colls.map(([k, l, n]) => navBtn('coll', k, l, n, S.f.coll === k)).join('')}
    </nav>
    <nav class="navsec" aria-label="Štítky"><div class="navtitle tagtitle"><span>Štítky <span class="tagcount">${allTagsN}</span></span>${hiddenTags > 0 ? `<button class="linkbtn" data-act="alltags" aria-expanded="${S.allTags}">${S.allTags ? 'Méně' : `Zobrazit všechny`}</button>` : ''}</div>
      ${tags.length ? tags.map(([t, n]) => navBtn('tag', t, t, n, S.f.tag === t, `hsl(${hueOf(t)} 60% 62%)`)).join('') : '<div class="navtitle" style="text-transform:none;letter-spacing:0">Zatím žádné</div>'}
      ${hiddenTags > 0 ? `<button class="linkbtn more" data-act="alltags">${S.allTags ? 'Méně štítků' : `Dalších ${hiddenTags} štítků…`}</button>` : ''}
    </nav>
    <div class="navsec"><div class="navtitle">Formát</div>
      <div class="fmts">${fmts.map(([x, n]) => `<button class="fmt${S.f.fmts.has(x) ? ' active' : ''}" data-act="fmt" data-v="${esc(x)}" aria-pressed="${S.f.fmts.has(x)}">${esc(x.toUpperCase())} <span class="n">${n}</span></button>`).join('')}</div>
    </div>`;
}

function chipsFor(p) {
  const ex = exts(p);
  const shown = ex.slice(0, 4);
  const more = ex.length - shown.length;
  return shown.map((x) => `<span class="chip">${esc(x.toUpperCase())}</span>`).join('') + (more > 0 ? `<span class="chip">+${more}</span>` : '');
}

function cardHtml(p, e) {
  const [olabel, ocol] = ORIGINS[e.origin];
  const st = e.status === 'toprint' ? 'K tisku' : e.status === 'printed' ? 'Vytištěno' : '';
  const first = p.models[0] ? p.models[0].ext.toUpperCase() : (exts(p)[0] || '').toUpperCase();
  const href = '#/p/' + encodeURIComponent(p.id);
  return `<article class="card">
    <div class="thumb" data-pid="${esc(p.id)}" style="background:linear-gradient(160deg,hsl(${hueOf(p.id)} 28% 22%),#14171d)">
      <div class="ph">${ICON.cube(44, 'hsl(' + hueOf(p.id) + ' 45% 60%)')}<b>${esc(first)}</b></div>
      <a class="cover" href="${href}" aria-label="Otevřít projekt ${esc(e.title)}"></a>
      <div class="badge"><span class="dot" style="background:${ocol}"></span>${olabel}</div>
      <button class="heart" data-act="fav" data-id="${esc(p.id)}" aria-pressed="${e.fav}" aria-label="${e.fav ? 'Odebrat z oblíbených' : 'Přidat do oblíbených'}"><span>${ICON.heart(e.fav)}</span></button>
      ${st ? `<div class="status-tag">${st}</div>` : ''}
    </div>
    <div class="cbody">
      <h2><a href="${href}">${esc(e.title)}</a></h2>
      <div class="chips">${chipsFor(p)}</div>
      <div class="mrow"><span class="t">${esc(e.tags.slice(0, 3).join(' · ') || ' ')}</span><span class="d">${fmtDate(p.mtime)}</span></div>
    </div>
  </article>`;
}

function renderMain() {
  const rows = visible();
  const sub = rows.length === S.projects.length
    ? `${rows.length} ${plural(rows.length, ['projekt', 'projekty', 'projektů'])} ze složky ${esc(S.lib.root)}`
    : `${rows.length} z ${S.projects.length} projektů`;
  const title = { all: 'Všechny projekty', fav: 'Oblíbené', toprint: 'K tisku', printed: 'Vytištěno' }[S.f.coll];
  const seg = [['all', 'Vše'], ['own', 'Vlastní'], ['downloaded', 'Stažené'], ['unknown', 'Neurčeno']];
  $('#main').innerHTML = `
    <div class="head">
      <div><h1>${title}${S.f.tag ? ` · ${esc(S.f.tag)}` : ''}</h1><p class="sub">${sub}</p></div>
      <div class="controls">
        <div class="seg" role="group" aria-label="Původ">${seg.map(([k, l]) => `<button class="${S.f.origin === k ? 'active' : ''}" data-act="origin" data-v="${k}" aria-pressed="${S.f.origin === k}">${l}</button>`).join('')}</div>
        <label class="sel">Řadit
          <select id="sort" aria-label="Řazení">
            ${[['new', 'Nejnovější změna'], ['old', 'Nejstarší'], ['name', 'Název A–Z'], ['big', 'Největší']].map(([k, l]) => `<option value="${k}"${S.sort === k ? ' selected' : ''}>${l}</option>`).join('')}
          </select>
        </label>
      </div>
    </div>
    ${rows.length ? `<div class="grid">${rows.map(({ p, e }) => cardHtml(p, e)).join('')}</div>` : '<div class="empty">Žádný projekt neodpovídá filtrům.</div>'}`;
  renderFoot(rows.length);
  observeThumbs();
}

// ---------------------------------------------------------------- náhledy karet
const io = new IntersectionObserver((entries) => {
  for (const en of entries) if (en.isIntersecting) { io.unobserve(en.target); loadThumb(en.target); }
}, { rootMargin: '400px' });
function observeThumbs() { document.querySelectorAll('.thumb[data-pid]').forEach((el) => io.observe(el)); }
async function loadThumb(el) {
  const p = S.byId.get(el.dataset.pid);
  if (!p) return;
  const url = await getThumb(p);
  if (!url || !el.isConnected) return;
  const src = pickSource(p);
  const img = new Image();
  img.alt = '';
  img.decoding = 'async';
  img.onload = () => {
    if (!el.isConnected) return;
    el.classList.toggle('photo', src.type === 'image');
    el.querySelector('.ph')?.remove();
    el.prepend(img);
  };
  img.src = url;
}

// ---------------------------------------------------------------- detail
const winPath = (rel) => {
  const root = S.lib.root.replace(/[\\/]+$/, '');
  const sep = root.includes('\\') ? '\\' : '/';
  return rel ? root + sep + rel.split('/').join(sep) : root;
};
const VIEW_EXT = new Set(['stl', '3mf', 'step', 'stp']);
const viewRank = (e) => (e === 'stl' ? 0 : e === '3mf' ? 1 : 2);
const viewables = (p) => p.models.filter((m) => VIEW_EXT.has(m.ext)).sort((a, b) => viewRank(a.ext) - viewRank(b.ext) || b.size - a.size);
const relName = (p, f) => f.path.slice(p.folder ? p.folder.length + 1 : 0);

function teardownViewer() {
  S.showTok++;
  if (S.viewer) { S.viewer.dispose(); S.viewer = null; }
}

function infoHtml(p) {
  const cf = curFile(p);
  if (cf) return fileInfoHtml(p, cf);
  const e = eff(p);
  const [olabel, ocol] = ORIGINS[e.origin];
  const ex = exts(p).map((x) => x.toUpperCase()).join(', ');
  const tags = e.tags.map((t) => {
    const own = e.userTags.includes(t);
    return `<span class="pillt${own ? ' own' : ''}">${esc(t)}${own ? `<button data-act="tag-del" data-v="${esc(t)}" aria-label="Odebrat štítek ${esc(t)}">×</button>` : ''}</span>`;
  }).join('');
  const files = [...p.files].sort((a, b) => extSort(a.ext, b.ext) || a.path.localeCompare(b.path, 'cs'));
  const n = p.files.length;
  return `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div class="tagrow"><span class="pillt own"><span class="dot" style="background:${ocol}"></span>${olabel}</span>${tags}
        <input class="addtag" id="addtag" placeholder="+ štítek" aria-label="Přidat štítek" maxlength="40"></div>
      <div class="titlerow"><h1 class="title">${esc(e.title)}</h1>
        <div style="display:flex;gap:8px">
          <button class="iconbtn" data-act="rename" aria-label="Přejmenovat projekt" title="Přejmenovat">${ICON.edit}</button>
          <button class="heartbtn" data-act="fav" data-id="${esc(p.id)}" aria-pressed="${e.fav}" aria-label="${e.fav ? 'Odebrat z oblíbených' : 'Přidat do oblíbených'}">${ICON.heart(e.fav, 20)}</button>
        </div></div>
      <p class="sub" style="margin:0">Změněno ${fmtDate(p.mtime)} · ${n} ${plural(n, ['soubor', 'soubory', 'souborů'])} · ${fmtSize(p.size)} · ${esc(ex)}</p>
      <div class="pathline">${esc(winPath(p.folder || ''))}</div>
    </div>
    <div class="btnrow">
      <button class="btn primary" data-act="open-sel">Otevřít ve slicer</button>
      <button class="btn" data-act="reveal-sel">Otevřít složku</button>
      <button class="btn" data-act="copy-sel">Kopírovat cestu</button>
    </div>
    <div><h2 class="h3">Soubory</h2><div class="files">
      ${files.map((f) => {
        const c = EXT_COLORS[f.ext] || ['#232834', '#b6bdca'];
        return `<div class="fr"><span class="ext" style="background:${c[0]};color:${c[1]}">${esc(f.ext.toUpperCase() || '—')}</span>${p.models.length > 1 && p.models.some((m) => m.path === f.path) ? `<button class="nm linkname" data-act="pick-file" data-path="${esc(f.path)}" title="Zobrazit detail souboru">${esc(relName(p, f))}</button>` : `<span class="nm">${esc(relName(p, f))}</span>`}<span class="sz">${fmtSize(f.size)}</span>
          <span class="acts"><button class="btn sm" data-act="open" data-path="${esc(f.path)}">Otevřít</button><button class="btn sm" data-act="reveal" data-path="${esc(f.path)}" aria-label="Zobrazit ve složce">Složka</button><button class="btn sm danger" data-act="del-file" data-path="${esc(f.path)}" aria-label="Smazat soubor ${esc(relName(p, f))} z disku">Smazat</button></span></div>`;
      }).join('')}
    </div></div>
    <div><h2 class="h3">Stav tisku a původ</h2>
      <div class="btnrow" style="margin-bottom:10px">
        <button class="stbtn${e.status === 'toprint' ? ' active' : ''}" data-act="status" data-v="toprint" aria-pressed="${e.status === 'toprint'}">K tisku</button>
        <button class="stbtn${e.status === 'printed' ? ' active' : ''}" data-act="status" data-v="printed" aria-pressed="${e.status === 'printed'}">Vytištěno</button>
      </div>
      <div class="btnrow">
        ${[['own', 'Vlastní'], ['downloaded', 'Stažené'], ['unknown', 'Neurčeno']].map(([k, l]) => `<button class="stbtn${e.origin === k ? ' active' : ''}" data-act="set-origin" data-v="${k}" aria-pressed="${e.origin === k}">${l}</button>`).join('')}
        ${e.originSet ? '<button class="stbtn" data-act="set-origin" data-v="">Automaticky</button>' : ''}
      </div>
    </div>
    <div><h2 class="h3">Poznámky</h2>
      <textarea class="notes" id="notes" rows="4" aria-label="Poznámka k projektu" placeholder="Nastavení tisku, použitý filament, co příště upravit…">${esc(e.notes)}</textarea></div>
    <div class="dangerzone"><h2 class="h3">Nebezpečná zóna</h2><p class="sub" style="margin:0 0 12px">Trvale smaže všechny soubory tohoto projektu z disku.</p><button class="btn danger" data-act="del-project">Smazat celý projekt…</button></div>`;
}

function statusOriginHtml(e) {
  return `<div><h2 class="h3">Stav tisku a původ</h2>
      <div class="btnrow" style="margin-bottom:10px">
        <button class="stbtn${e.status === 'toprint' ? ' active' : ''}" data-act="status" data-v="toprint" aria-pressed="${e.status === 'toprint'}">K tisku</button>
        <button class="stbtn${e.status === 'printed' ? ' active' : ''}" data-act="status" data-v="printed" aria-pressed="${e.status === 'printed'}">Vytištěno</button>
      </div>
      <div class="btnrow">
        ${[['own', 'Vlastní'], ['downloaded', 'Stažené'], ['unknown', 'Neurčeno']].map(([k, l]) => `<button class="stbtn${e.origin === k ? ' active' : ''}" data-act="set-origin" data-v="${k}" aria-pressed="${e.origin === k}">${l}</button>`).join('')}
        ${e.originSet ? '<button class="stbtn" data-act="set-origin" data-v="">Automaticky</button>' : ''}
      </div>
    </div>`;
}

function fileInfoHtml(p, f) {
  const e = feff(p, f);
  const [olabel, ocol] = ORIGINS[e.origin];
  const c = EXT_COLORS[f.ext] || ['#232834', '#b6bdca'];
  const tags = e.tags.map((t) => {
    const own = e.userTags.includes(t);
    return `<span class="pillt${own ? ' own' : ''}">${esc(t)}${own ? `<button data-act="tag-del" data-v="${esc(t)}" aria-label="Odebrat štítek ${esc(t)}">×</button>` : ''}</span>`;
  }).join('');
  const n = p.files.length;
  return `
    <div style="display:flex;flex-direction:column;gap:12px">
      <div><button class="btn sm" data-act="to-project">← Celý projekt „${esc(eff(p).title)}“ (${n} ${plural(n, ['soubor', 'soubory', 'souborů'])})</button></div>
      <div class="tagrow"><span class="pillt own"><span class="dot" style="background:${ocol}"></span>${olabel}</span>${tags}
        <input class="addtag" id="addtag" placeholder="+ štítek" aria-label="Přidat štítek" maxlength="40"></div>
      <div class="titlerow"><h1 class="title" style="overflow-wrap:anywhere">${esc(e.title)}</h1>
        <div style="display:flex;gap:8px">
          <button class="iconbtn" data-act="rename-file" aria-label="Přejmenovat soubor na disku" title="Přejmenovat soubor">${ICON.edit}</button>
          <button class="heartbtn" data-act="fav" data-id="${esc(fkey(f.path))}" aria-pressed="${e.fav}" aria-label="${e.fav ? 'Odebrat z oblíbených' : 'Přidat do oblíbených'}">${ICON.heart(e.fav, 20)}</button>
        </div></div>
      <p class="sub" style="margin:0"><span class="ext" style="display:inline-block;padding:2px 8px;border-radius:6px;font-family:var(--mono);font-size:11px;background:${c[0]};color:${c[1]}">${esc(f.ext.toUpperCase() || '—')}</span> Změněno ${fmtDate(f.mtime)} · ${fmtSize(f.size)}</p>
      <div class="pathline">${esc(winPath(f.path))}</div>
    </div>
    <div class="btnrow">
      <button class="btn primary" data-act="open-sel">Otevřít ve slicer</button>
      <button class="btn" data-act="reveal-sel">Otevřít složku</button>
      <button class="btn" data-act="copy-sel">Kopírovat cestu</button>
    </div>
    ${statusOriginHtml(e)}
    <div><h2 class="h3">Poznámky</h2>
      <textarea class="notes" id="notes" rows="4" aria-label="Poznámka k souboru" placeholder="Nastavení tisku, použitý filament, co příště upravit…">${esc(e.notes)}</textarea></div>
    <div class="dangerzone"><h2 class="h3">Nebezpečná zóna</h2><p class="sub" style="margin:0 0 12px">Trvale smaže tento soubor z disku.</p><button class="btn danger" data-act="del-file" data-path="${esc(f.path)}">Smazat soubor…</button></div>`;
}

function renderDetail(id) {
  const p = S.byId.get(id);
  if (!p) { location.hash = '#/'; return; }
  teardownViewer();
  const e = eff(p);
  const vs = viewables(p);
  const imgs = [...p.images].sort((a, b) => a.path.localeCompare(b.path));
  const pend = S.pendingSel; S.pendingSel = null;
  if (S.detailId !== id) { S.panel = 'project'; S.fsel = null; }
  S.detailId = id;
  if (pend) { S.panel = 'file'; S.fsel = pend; }
  if (S.panel === 'file' && (p.models.length < 2 || !p.files.some((f) => f.path === S.fsel))) { S.panel = 'project'; S.fsel = null; }
  S.sel = vs[0] ? vs[0].path : (p.models[0] ? p.models[0].path : (p.files[0] ? p.files[0].path : null));
  if (S.panel === 'file' && p.files.find((f) => f.path === S.fsel && VIEW_EXT.has(f.ext))) S.sel = S.fsel;
  $('#content').innerHTML = `
    <div style="padding:16px 24px 0;display:flex;flex-wrap:wrap;gap:12px 20px;align-items:center">
      <a class="back" href="#/">${ICON.back}Všechny projekty</a>
      <div class="crumb">STL Knihovna <span style="padding:0 6px">/</span> <b>${esc(e.title)}</b></div>
    </div>
    <div class="detail">
      <section class="left">
        <div class="stage" id="stage"><div id="vwr"></div><img class="big" id="bigimg" alt="" hidden><div class="msg" id="stmsg" hidden></div><div class="info" id="stinfo"></div></div>
        <div class="strip" id="strip">
          ${vs.map((f) => `<button class="si" data-act="pick" data-path="${esc(f.path)}"><span class="sw">${ICON.cube(30, '#6fe0a8')}</span><span class="l">${esc(relName(p, f))}</span></button>`).join('')}
          ${imgs.slice(0, 12).map((f) => `<button class="si" data-act="pick" data-path="${esc(f.path)}"><span class="sw"><img loading="lazy" alt="" src="${api.fileUrl(f.path)}"></span><span class="l">${esc(relName(p, f))}</span></button>`).join('')}
        </div>
      </section>
      <section class="right" id="info">${infoHtml(p)}</section>
    </div>`;
  window.scrollTo(0, 0);
  renderFoot();
  if (S.sel) showItem(p, S.sel);
  else setStageMsg('Projekt neobsahuje soubor s 3D náhledem.');
}

function setStageMsg(html) {
  const m = $('#stmsg');
  if (!m) return;
  m.innerHTML = html;
  m.hidden = !html;
}

const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp']);
async function showItem(p, path) {
  const tok = ++S.showTok;
  S.sel = path;
  const f = p.files.find((x) => x.path === path);
  if (!f) return;
  document.querySelectorAll('#strip .si').forEach((b) => b.classList.toggle('active', b.dataset.path === path));
  document.querySelector('#strip .si.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  const big = $('#bigimg');
  const info = $('#stinfo');
  info.innerHTML = '';
  if (IMG_EXT.has(f.ext)) {
    setStageMsg('');
    big.src = api.fileUrl(path);
    big.hidden = false;
    $('#vwr').style.visibility = 'hidden';
    return;
  }
  big.hidden = true;
  $('#vwr').style.visibility = 'visible';
  if (!VIEW_EXT.has(f.ext)) {
    setStageMsg(`${ICON.cube(48, '#9aa3b2')}<div>Náhled formátu ${esc(f.ext.toUpperCase())} zatím není k dispozici.<br>Soubor otevřeš tlačítkem „Otevřít“.</div>`);
    if (S.viewer) S.viewer.clear();
    return;
  }
  setStageMsg(f.ext === 'step' || f.ext === 'stp' ? '<div>Převádím STEP na 3D model…<br><span style="font-size:12px">u velkých souborů to může chvíli trvat</span></div>' : '<div>Načítám model…</div>');
  try {
    if (!S.viewer) {
      const { Viewer } = await import('./viewer.js');
      if (tok !== S.showTok) return;
      S.viewer = new Viewer($('#vwr'), S.cfg.bed || [256, 256, 256]);
    }
    const r = await S.viewer.load(api.fileUrl(path), f.ext);
    if (tok !== S.showTok) return;
    setStageMsg('');
    const bed = S.cfg.bed || [256, 256, 256];
    const nf = (n) => n.toLocaleString('cs-CZ', { maximumFractionDigits: 1 });
    info.innerHTML = `<span class="pill">${nf(r.dims[0])} × ${nf(r.dims[1])} × ${nf(r.dims[2])} mm</span>
      <span class="pill">${r.tris.toLocaleString('cs-CZ')} trojúhelníků</span>
      <span class="pill ${r.fits ? 'ok' : 'warn'}">${r.fits ? `Vejde se na podložku ${bed.join('×')}` : `Přesahuje podložku ${bed.join('×')}`}</span>`;
  } catch (err) {
    if (tok !== S.showTok) return;
    if (S.viewer) S.viewer.clear();
    setStageMsg(`${ICON.cube(48, '#9aa3b2')}<div>Model se nepodařilo zobrazit.<br><span style="font-size:12px">${esc(err.message || err)}</span></div>`);
  }
}

function rerenderInfo(p) { $('#info').innerHTML = infoHtml(p); }
function curProject() {
  const m = location.hash.match(/^#\/p\/(.+)$/);
  return m ? S.byId.get(decodeURIComponent(m[1])) : null;
}
async function doOpen(path, mode) {
  try { await api.open(path, mode); } catch (e) { toast('Nepodařilo se otevřít: ' + e.message, true); }
}

// ---------------------------------------------------------------- změna složky s modely
const rootSt = { path: '', parent: null, dirs: [] };

async function browseTo(path, keepInput = false) {
  const err = $('#rooterr');
  try {
    const r = await api.browse(path);
    rootSt.path = r.path;
    rootSt.parent = r.parent;
    rootSt.dirs = r.dirs;
    err.hidden = true;
    if (!keepInput && r.path) $('#rootinput').value = r.path;
    renderBrowser();
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  }
}

function renderBrowser() {
  const b = $('#browser');
  if (!b) return;
  b.innerHTML = `<div class="browsehead">
      <button type="button" class="btn sm" data-act="root-up" ${rootSt.parent == null ? 'disabled' : ''}>↑ Nahoru</button>
      <span class="pathline">${esc(rootSt.path || 'Disky')}</span></div>
    <div class="browselist">${rootSt.dirs.length
      ? rootSt.dirs.map((d) => `<button type="button" class="navbtn" data-act="root-into" data-path="${esc(d.path)}"><span class="lbl">${ICON.folder}${esc(d.name)}</span></button>`).join('')
      : '<div class="sub" style="padding:12px">Žádné podsložky</div>'}</div>`;
}

async function rootDialog() {
  const d = $('#dlg');
  const cur = S.lib.root;
  const recent = (S.cfg.recentRoots || []).filter((r) => r.toLowerCase() !== cur.toLowerCase());
  d.innerHTML = `<form method="dialog" class="dlgbox"><h2 id="dlgtitle">Složka s modely</h2>
    <p>Zadej cestu nebo složku vyber v seznamu. Poznámky, štítky a náhledy se ukládají zvlášť pro každou složku.</p>
    <label class="rootlabel">Cesta<input id="rootinput" class="rootinput" value="${esc(cur)}" spellcheck="false" autocomplete="off"></label>
    <div id="rooterr" class="rooterr" role="alert" hidden></div>
    <div class="browser" id="browser"></div>
    ${recent.length ? `<div><h3 class="h3">Naposledy použité</h3>${recent.map((r) => `<button type="button" class="navbtn" data-act="root-pick" data-path="${esc(r)}"><span class="lbl">${esc(r)}</span></button>`).join('')}</div>` : ''}
    <div class="dlgbtns"><button class="btn" value="cancel" formnovalidate>Zrušit</button><button type="button" class="btn primary" data-act="root-apply">Použít složku</button></div></form>`;
  d.returnValue = '';
  d.showModal();
  browseTo(cur, true);
}

async function applyRoot() {
  const val = $('#rootinput').value.trim();
  const err = $('#rooterr');
  const btn = document.querySelector('[data-act="root-apply"]');
  try {
    btn.disabled = true;
    const r = await api.setRoot(val);
    $('#dlg').close('ok');
    S.f = { q: '', coll: 'all', origin: 'all', tag: null, fmts: new Set() };
    S.scrollY = 0;
    $('#app').innerHTML = '<div class="loading">Načítám knihovnu…</div>';
    await Promise.all([loadAll(), initThumbs()]);
    renderShell();
    if (location.hash.startsWith('#/p/')) location.hash = '#/'; else route();
    toast('Složka změněna: ' + r.root + (r.saved === false ? ' (nepodařilo se uložit do config.json)' : ''), r.saved === false);
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------- mazání
function confirmDelete(title, html) {
  return new Promise((resolve) => {
    const d = $('#dlg');
    d.innerHTML = `<form method="dialog" class="dlgbox"><h2 id="dlgtitle">${esc(title)}</h2>${html}
      <div class="dlgbtns"><button class="btn" value="cancel" autofocus>Zrušit</button><button class="btn dangerfill" value="ok">Smazat natrvalo</button></div></form>`;
    d.returnValue = '';
    d.addEventListener('close', () => resolve(d.returnValue === 'ok'), { once: true });
    d.showModal();
  });
}

async function deleteFlow(p, paths, whole) {
  const files = paths.map((x) => p.files.find((f) => f.path === x)).filter(Boolean);
  if (!files.length) return;
  const total = files.reduce((a, f) => a + f.size, 0);
  const list = files.slice(0, 8).map((f) => `<li><span>${esc(relName(p, f))}</span><span>${fmtSize(f.size)}</span></li>`).join('')
    + (files.length > 8 ? `<li><span>… a dalších ${files.length - 8}</span><span></span></li>` : '');
  const ok = await confirmDelete(
    whole ? `Smazat projekt „${eff(p).title}“?` : 'Smazat soubor?',
    `<p>Z disku bude <b>trvale smazáno ${files.length} ${plural(files.length, ['soubor', 'soubory', 'souborů'])}</b> (${fmtSize(total)}). Smazané soubory nepůjde obnovit ani z koše.</p><ul class="dlglist">${list}</ul>`
  );
  if (!ok) return;
  try {
    const r = await api.deleteFiles(files.map((f) => f.path));
    const bad = (r.failed || []).length;
    await loadAll(true);
    forgetThumb(p.id);
    if (!S.byId.has(p.id)) {
      if (S.meta[p.id]) { delete S.meta[p.id]; dirty = true; flushMeta(); }
      location.hash = '#/';
    } else {
      renderDetail(p.id);
    }
    for (const d of (r.deleted || [])) if (S.meta[fkey(d)]) { delete S.meta[fkey(d)]; dirty = true; }
    flushMeta();
    const n = (r.deleted || []).length;
    toast(bad ? `Smazáno ${n}, nepovedlo se ${bad}: ${r.failed[0].error}` : `Smazáno: ${n} ${plural(n, ['soubor', 'soubory', 'souborů'])}`, !!bad);
  } catch (e) {
    toast('Mazání selhalo: ' + e.message, true);
  }
}

// ---------------------------------------------------------------- události
document.addEventListener('click', async (ev) => {
  const el = ev.target.closest('[data-act]');
  if (!el) return;
  const act = el.dataset.act;
  const v = el.dataset.v;
  const p = curProject();
  switch (act) {
    case 'coll': S.f.coll = v; renderSide(); renderMain(); break;
    case 'tag': S.f.tag = S.f.tag === v ? null : v; renderSide(); renderMain(); break;
    case 'alltags': S.allTags = !S.allTags; try { localStorage.setItem('stl.allTags', S.allTags ? '1' : ''); } catch { /* ignore */ } renderSide(); break;
    case 'fmt': if (S.f.fmts.has(v)) S.f.fmts.delete(v); else S.f.fmts.add(v); renderSide(); renderMain(); break;
    case 'origin': S.f.origin = v; renderMain(); break;
    case 'fav': {
      ev.preventDefault();
      const id = el.dataset.id;
      const cur = !!(S.meta[id] && S.meta[id].fav);
      updateMeta(id, { fav: !cur });
      if (p) rerenderInfo(p); else { renderSide(); renderMain(); }
      break;
    }
    case 'rescan':
      try {
        el.disabled = true;
        await loadAll(true);
        if (p) renderDetail(p.id); else { renderSide(); renderMain(); }
        toast(`Nalezeno ${S.projects.length} ${plural(S.projects.length, ['projekt', 'projekty', 'projektů'])}`);
      } catch (e) { toast('Prohledání selhalo: ' + e.message, true); } finally { el.disabled = false; }
      break;
    case 'pick':
    case 'pick-file':
      if (p) {
        const path = el.dataset.path;
        const f = p.files.find((x) => x.path === path);
        if (f && p.models.length > 1 && p.models.some((m) => m.path === f.path)) {
          S.panel = 'file'; S.fsel = path;
          rerenderInfo(p);
          if (window.scrollY > 150) window.scrollTo({ top: 0, behavior: 'smooth' });
        }
        showItem(p, path);
      }
      break;
    case 'to-project': if (p) { S.panel = 'project'; S.fsel = null; rerenderInfo(p); } break;
    case 'rename-file': {
      const f = curFile(p);
      if (!f) break;
      const old = baseName(f.path);
      const name = window.prompt('Nový název souboru (včetně přípony). Soubor se přejmenuje i na disku:', old);
      if (name === null || !name.trim() || name.trim() === old) break;
      try {
        const r = await api.renameFile(f.path, name.trim());
        const ok = fkey(f.path), nk = fkey(r.path);
        if (S.meta[ok]) { S.meta[nk] = S.meta[ok]; delete S.meta[ok]; dirty = true; flushMeta(); }
        const oldId = p.id;
        await loadAll(true);
        forgetThumb(oldId);
        const np = S.projects.find((x) => x.files.some((ff) => ff.path === r.path));
        if (!np) { location.hash = '#/'; break; }
        S.pendingSel = r.path;
        if (np.id === oldId) renderDetail(np.id); else location.hash = '#/p/' + encodeURIComponent(np.id);
        toast('Soubor přejmenován');
      } catch (e) { toast('Přejmenování selhalo: ' + e.message, true); }
      break;
    }
    case 'open': doOpen(el.dataset.path, 'open'); break;
    case 'reveal': doOpen(el.dataset.path, 'reveal'); break;
    case 'open-sel': if (selPath()) doOpen(selPath(), 'open'); break;
    case 'reveal-sel': if (selPath()) doOpen(selPath(), 'reveal'); break;
    case 'copy-sel':
      if (selPath()) {
        try { await navigator.clipboard.writeText(winPath(selPath())); toast('Cesta zkopírována'); } catch { toast('Kopírování se nepovedlo', true); }
      }
      break;
    case 'rename': {
      if (!p) break;
      const name = window.prompt('Nový název projektu (prázdné = původní):', eff(p).title);
      if (name === null) break;
      updateMeta(p.id, { title: name.trim() === p.name ? '' : name.trim() });
      renderDetail(p.id);
      break;
    }
    case 'status': if (p) { const cur = teff(p).status; updateMeta(tid(p), { status: cur === v ? '' : v }); rerenderInfo(p); } break;
    case 'set-origin': if (p) { updateMeta(tid(p), { origin: v }); rerenderInfo(p); } break;
    case 'tag-del': if (p) { updateMeta(tid(p), { tags: teff(p).userTags.filter((t) => t !== v) }); rerenderInfo(p); } break;
    case 'root-dialog': rootDialog(); break;
    case 'root-up': if (rootSt.parent != null) browseTo(rootSt.parent); break;
    case 'root-into': browseTo(el.dataset.path); break;
    case 'root-pick': $('#rootinput').value = el.dataset.path; browseTo(el.dataset.path); break;
    case 'root-apply': applyRoot(); break;
    case 'del-file': if (p) deleteFlow(p, [el.dataset.path], false); break;
    case 'del-project': if (p) deleteFlow(p, p.files.map((f) => f.path), true); break;
    default: break;
  }
});

document.addEventListener('change', (ev) => {
  if (ev.target.id === 'sort') { S.sort = ev.target.value; renderMain(); }
});
document.addEventListener('input', (ev) => {
  if (ev.target.id === 'notes') { const p = curProject(); if (p) updateMeta(tid(p), { notes: ev.target.value }); }
});
document.addEventListener('keydown', (ev) => {
  const t = ev.target;
  if (t.id === 'addtag' && ev.key === 'Enter') {
    const p = curProject();
    const tag = t.value.trim();
    if (p && tag) {
      const cur = teff(p).userTags;
      if (!cur.includes(tag)) updateMeta(tid(p), { tags: [...cur, tag] });
      rerenderInfo(p);
      $('#addtag')?.focus();
    }
    return;
  }
  if (t.id === 'rootinput' && ev.key === 'Enter') { ev.preventDefault(); browseTo(t.value.trim(), true); return; }
  if (document.querySelector('dialog[open]')) return;
  const typing = /INPUT|TEXTAREA|SELECT/.test(t.tagName);
  if (ev.key === '/' && !typing) { ev.preventDefault(); $('#q')?.focus(); }
  if (ev.key === 'Escape' && !typing && location.hash.startsWith('#/p/')) location.hash = '#/';
});

// ---------------------------------------------------------------- router
function route() {
  const m = location.hash.match(/^#\/p\/(.+)$/);
  if (m) {
    if (!document.querySelector('.detail')) S.scrollY = window.scrollY;
    renderDetail(decodeURIComponent(m[1]));
  } else {
    teardownViewer();
    S.detailId = null; S.panel = 'project'; S.fsel = null;
    renderLibrary();
  }
}
window.addEventListener('hashchange', route);

// ---------------------------------------------------------------- start
(async function init() {
  $('#app').innerHTML = '<div class="loading">Načítám knihovnu…</div>';
  try {
    await Promise.all([loadAll(), initThumbs()]);
  } catch (e) {
    $('#app').innerHTML = `<div class="loading">Nepodařilo se načíst knihovnu.<br><span style="font-size:12px">${esc(e.message || e)}</span></div>`;
    return;
  }
  renderShell();
  route();
})();
