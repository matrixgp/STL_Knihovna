// Vývojový / záložní server v Node.js se stejným API jako Program.cs.
// Použití: node dev/server.mjs [cesta ke složce s modely]
import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(appDir, 'config.json'), 'utf8'));
let root = path.resolve(process.argv[2] || process.env.STL_ROOT || config.root);
const port = Number(process.env.PORT || config.port || 5173);
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(appDir, 'data');
const persistConfig = !process.env.DATA_DIR; // v testech config.json nepřepisujeme
let thumbDir = '';
let metaPath = '';
// Data jsou uložená zvlášť pro každou složku s modely: data/roots/<hash>/
function activateData(rootPath, migrateLegacy) {
  const key = crypto.createHash('sha1').update(rootPath.replace(/[\\/]+$/, '').toLowerCase()).digest('hex').slice(0, 10);
  const d = path.join(dataDir, 'roots', key);
  fs.mkdirSync(path.join(d, 'thumbs'), { recursive: true });
  fs.writeFileSync(path.join(d, 'root.txt'), rootPath);
  metaPath = path.join(d, 'meta.json');
  thumbDir = path.join(d, 'thumbs');
  if (!migrateLegacy) return;
  const lm = path.join(dataDir, 'meta.json');
  const lt = path.join(dataDir, 'thumbs');
  if (fs.existsSync(lm) && !fs.existsSync(metaPath)) fs.renameSync(lm, metaPath);
  if (fs.existsSync(lt)) {
    for (const f of fs.readdirSync(lt).filter((x) => x.endsWith('.png'))) {
      const dest = path.join(thumbDir, f);
      if (!fs.existsSync(dest)) fs.renameSync(path.join(lt, f), dest);
    }
  }
}
activateData(root, true);

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.wasm': 'application/wasm', '.pdf': 'application/pdf' };
const OPEN_OK = new Set(['stl', '3mf', 'step', 'stp', 'obj', 'f3d', 'f3z', 'fcstd', 'skp', 'scad', 'amf', 'ply', 'iges', 'igs', 'gcode', 'svg', 'dxf', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'pdf', 'txt', 'md']);

function resolveRel(rel) {
  if (!rel) return null;
  const full = path.resolve(root, rel);
  return full === root || full.startsWith(root + path.sep) ? full : null;
}
function scan(dir, out, depth = 0) {
  if (depth > 12) return;
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) scan(full, out, depth + 1);
    else if (e.isFile()) {
      try {
        const st = fs.statSync(full);
        out.push({ p: path.relative(root, full).split(path.sep).join('/'), s: st.size, m: Math.round(st.mtimeMs) });
      } catch { /* ignore */ }
    }
  }
}
const body = (req, limit = 3_000_000) => new Promise((resolve, reject) => {
  const chunks = []; let n = 0;
  req.on('data', (c) => { n += c.length; if (n > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks)));
  req.on('error', reject);
});
const send = (res, code, data, type = 'application/json', extra = {}) => {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-cache', ...extra });
  res.end(data);
};

function openPath(full, mode) {
  if (process.platform !== 'win32') return false;
  if (mode === 'reveal') {
    const isDir = fs.statSync(full).isDirectory();
    spawn('explorer.exe', isDir ? [full] : ['/select,' + full], { detached: true, stdio: 'ignore' }).unref();
    return true;
  }
  if (config.slicer) spawn(config.slicer, [full], { detached: true, stdio: 'ignore' }).unref();
  else spawn('cmd.exe', ['/c', 'start', '""', full], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref();
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const mutating = req.method !== 'GET' && req.method !== 'HEAD';
    if (mutating && !req.headers['x-stl']) return send(res, 403, '{"error":"forbidden"}');

    if (p === '/api/library') {
      const files = []; scan(root, files);
      return send(res, 200, JSON.stringify({ root, config, files, version: 'dev', built: '' }));
    }
    if (p === '/api/file') {
      const full = resolveRel(url.searchParams.get('path'));
      if (!full || !fs.existsSync(full) || !fs.statSync(full).isFile()) return send(res, 404, '{}');
      const st = fs.statSync(full);
      const type = MIME[path.extname(full).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
      return fs.createReadStream(full).pipe(res);
    }
    if (p === '/api/open' && req.method === 'POST') {
      const { path: rel, mode } = JSON.parse((await body(req)).toString('utf8'));
      const full = resolveRel(rel);
      if (!full || !fs.existsSync(full)) return send(res, 404, '{"error":"not found"}');
      if (mode !== 'reveal') {
        const ext = path.extname(full).slice(1).toLowerCase();
        if (!OPEN_OK.has(ext)) return send(res, 400, '{"error":"typ souboru nelze otevřít"}');
      }
      return openPath(full, mode) ? send(res, 200, '{"ok":true}') : send(res, 501, '{"error":"otevírání funguje jen na Windows"}');
    }
    if (p === '/api/browse') {
      if (!req.headers['x-stl']) return send(res, 403, '{"error":"forbidden"}');
      const q = (url.searchParams.get('path') || '').trim().replace(/^"|"$/g, '');
      if (!q) {
        const dirs = process.platform === 'win32'
          ? 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((l) => l + ':\\').filter((d) => fs.existsSync(d)).map((d) => ({ name: d, path: d }))
          : [{ name: '/', path: '/' }];
        return send(res, 200, JSON.stringify({ path: '', parent: null, dirs }));
      }
      const full = path.resolve(q);
      if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) return send(res, 404, JSON.stringify({ error: 'Složka neexistuje: ' + full }));
      const dirs = fs.readdirSync(full, { withFileTypes: true }).filter((e) => e.isDirectory())
        .map((e) => ({ name: e.name, path: path.join(full, e.name) })).sort((a, b) => a.name.localeCompare(b.name, 'cs'));
      const parent = path.dirname(full) === full ? '' : path.dirname(full);
      return send(res, 200, JSON.stringify({ path: full, parent, dirs }));
    }
    if (p === '/api/root' && req.method === 'POST') {
      const { path: input } = JSON.parse((await body(req)).toString('utf8'));
      const val = String(input || '').trim().replace(/^"|"$/g, '');
      if (!val) return send(res, 400, JSON.stringify({ error: 'Zadej cestu ke složce' }));
      const full = path.resolve(val);
      if (!fs.existsSync(full) || !fs.statSync(full).isDirectory()) return send(res, 400, JSON.stringify({ error: 'Složka neexistuje: ' + full }));
      root = full;
      activateData(root, false);
      config.root = full;
      config.recentRoots = [full, ...(config.recentRoots || []).filter((r) => r.toLowerCase() !== full.toLowerCase())].slice(0, 8);
      let saved = false;
      if (persistConfig) { try { fs.writeFileSync(path.join(appDir, 'config.json'), JSON.stringify(config, null, 2)); saved = true; } catch { /* ignore */ } }
      return send(res, 200, JSON.stringify({ root, saved }));
    }
    if (p === '/api/delete' && req.method === 'POST') {
      const { paths } = JSON.parse((await body(req)).toString('utf8'));
      if (!Array.isArray(paths) || !paths.length || paths.length > 2000) return send(res, 400, '{"error":"Neplatný požadavek"}');
      const deleted = []; const failed = [];
      for (const rel of paths) {
        const full = resolveRel(rel);
        if (!full || !fs.existsSync(full) || !fs.statSync(full).isFile()) { failed.push({ path: rel, error: 'Soubor nenalezen' }); continue; }
        try {
          fs.unlinkSync(full); deleted.push(rel);
          let dir = path.dirname(full);
          while (dir !== root && dir.startsWith(root + path.sep) && fs.readdirSync(dir).length === 0) { fs.rmdirSync(dir); dir = path.dirname(dir); }
        } catch (e) { failed.push({ path: rel, error: String(e.message || e) }); }
      }
      return send(res, 200, JSON.stringify({ deleted, failed }));
    }
    if (p === '/api/rename' && req.method === 'POST') {
      const j = JSON.parse((await body(req)).toString('utf8'));
      const name = String(j.name || '').trim();
      const full = resolveRel(j.path);
      if (!full || !fs.existsSync(full) || !fs.statSync(full).isFile()) return send(res, 400, '{"error":"Soubor nenalezen"}');
      if (!name || name.length > 200 || name === '.' || name === '..' || name.endsWith('.') || /[\\/:*?"<>|\x00-\x1f]/.test(name)) return send(res, 400, '{"error":"Neplatný název souboru"}');
      const target = path.join(path.dirname(full), name);
      if (!resolveRel(path.relative(root, target))) return send(res, 400, '{"error":"Neplatný název souboru"}');
      if (target.toLowerCase() !== full.toLowerCase() && fs.existsSync(target)) return send(res, 409, '{"error":"Soubor s tímto názvem už existuje"}');
      fs.renameSync(full, target);
      return send(res, 200, JSON.stringify({ path: path.relative(root, target).split(path.sep).join('/') }));
    }
    if (p === '/api/meta') {
      if (req.method === 'GET') return send(res, 200, fs.existsSync(metaPath) ? fs.readFileSync(metaPath) : '{}');
      if (req.method === 'PUT') {
        const text = (await body(req, 10_000_000)).toString('utf8');
        JSON.parse(text);
        fs.writeFileSync(metaPath + '.tmp', text); fs.renameSync(metaPath + '.tmp', metaPath);
        return send(res, 204, '');
      }
    }
    if (p === '/api/thumbs') {
      return send(res, 200, JSON.stringify(fs.readdirSync(thumbDir).filter((f) => f.endsWith('.png')).map((f) => f.slice(0, -4))));
    }
    const tm = p.match(/^\/api\/thumb\/([a-z0-9-]{4,80})$/);
    if (tm) {
      const f = path.join(thumbDir, tm[1] + '.png');
      if (req.method === 'GET') return fs.existsSync(f) ? send(res, 200, fs.readFileSync(f), 'image/png', { 'Cache-Control': 'max-age=31536000, immutable' }) : send(res, 404, '');
      if (req.method === 'PUT') { fs.writeFileSync(f, await body(req, 2_000_000)); return send(res, 204, ''); }
    }

    // statické soubory
    let rel = p === '/' ? '/index.html' : decodeURIComponent(p);
    const sf = path.resolve(appDir, 'wwwroot' + rel);
    if (!sf.startsWith(path.join(appDir, 'wwwroot')) || !fs.existsSync(sf) || !fs.statSync(sf).isFile()) return send(res, 404, 'not found', 'text/plain');
    return send(res, 200, fs.readFileSync(sf), MIME[path.extname(sf).toLowerCase()] || 'application/octet-stream');
  } catch (e) {
    return send(res, 500, JSON.stringify({ error: String(e.message || e) }));
  }
});
server.listen(port, '127.0.0.1', () => console.log(`STL Knihovna (Node) běží na http://127.0.0.1:${port}  |  složka: ${root}`));
