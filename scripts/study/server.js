import { createServer } from 'node:http';

// Fixed in-memory document only: no filesystem paths or agent routes from requests.
export function createStudyServer(html) {
  return createServer((req, res) => {
    const headers = { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; font-src data:; img-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" };
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405, { allow: 'GET, HEAD' }); res.end('Read-only study document.'); return; }
    let path;
    try { path = new URL(req.url, 'http://localhost').pathname; } catch { res.writeHead(400); res.end(); return; }
    if (!['/', '/ORAL_EXAM_STUDY.html', '/favicon.ico'].includes(path)) { res.writeHead(404); res.end('Not found.'); return; }
    if (path === '/favicon.ico') { res.writeHead(204); res.end(); return; }
    res.writeHead(200, headers); res.end(req.method === 'HEAD' ? undefined : html);
  });
}
