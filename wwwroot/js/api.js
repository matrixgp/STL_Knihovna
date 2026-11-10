const H = { 'X-STL': '1' };
const J = { ...H, 'Content-Type': 'application/json' };

async function check(r) {
  if (!r.ok) {
    let msg = r.status;
    try { msg = (await r.json()).error || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return r;
}

export const api = {
  library: () => fetch('/api/library', { cache: 'no-store' }).then(check).then((r) => r.json()),
  meta: () => fetch('/api/meta', { cache: 'no-store' }).then(check).then((r) => r.json()),
  saveMeta: (m) => fetch('/api/meta', { method: 'PUT', headers: J, body: JSON.stringify(m) }).then(check),
  deleteFiles: (paths) => fetch('/api/delete', { method: 'POST', headers: J, body: JSON.stringify({ paths }) }).then(check).then((r) => r.json()),
  browse: (path) => fetch('/api/browse?path=' + encodeURIComponent(path || ''), { headers: H, cache: 'no-store' }).then(check).then((r) => r.json()),
  setRoot: (path) => fetch('/api/root', { method: 'POST', headers: J, body: JSON.stringify({ path }) }).then(check).then((r) => r.json()),
  renameFile: (path, name) => fetch('/api/rename', { method: 'POST', headers: J, body: JSON.stringify({ path, name }) }).then(check).then((r) => r.json()),
  open: (path, mode) => fetch('/api/open', { method: 'POST', headers: J, body: JSON.stringify({ path, mode }) }).then(check),
  fileUrl: (p) => '/api/file?path=' + encodeURIComponent(p),
  thumbs: () => fetch('/api/thumbs', { cache: 'no-store' }).then(check).then((r) => r.json()),
  thumbUrl: (k) => '/api/thumb/' + k,
  putThumb: (k, blob) => fetch('/api/thumb/' + k, { method: 'PUT', headers: H, body: blob }).then(check)
};
