'use strict';
/*
 * Сервер «Профессия будущего». Без внешних зависимостей, нужен только Node.js 18+.
 *   npm start
 * Переменные окружения:
 *   PORT         порт (по умолчанию 3000)
 *   SITE_URL     адрес сайта без слэша в конце, например https://profession2035.example (нужен для SEO)
 *   DATA_DIR     где хранить stats.json (по умолчанию ./data). На хостинге укажите постоянный диск.
 *   ADMIN_TOKEN  если задан, статистика по профессиям доступна по /api/admin?token=...
 *   TRUST_PROXY  1, если сайт стоит за nginx/Cloudflare и IP берётся из X-Forwarded-For
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const TREE = require('./public/tree.js');

const PORT = Number(process.env.PORT) || 3000;
const SITE_URL = (process.env.SITE_URL || '').replace(/\/+$/, '');
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const TRUST_PROXY = process.env.TRUST_PROXY === '1';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'stats.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

// ---------- Хранилище ----------
let data = { visits: 0, completions: 0, leaves: {}, ratings: {}, users: {}, salt: crypto.randomBytes(16).toString('hex') };
try {
  const loaded = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  data = Object.assign(data, loaded);
  if (!data.users) data.users = {};
} catch (e) { /* первый запуск */ }

let saveTimer = null;
function saveNow() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = DATA_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) { console.error('Не удалось сохранить статистику:', e.message); }
  saveTimer = null;
}
function scheduleSave() { if (!saveTimer) saveTimer = setTimeout(saveNow, 1000); }
['SIGINT', 'SIGTERM'].forEach(function (s) { process.on(s, function () { saveNow(); process.exit(0); }); });

function publicStats() {
  const vals = Object.values(data.ratings);
  const sum = vals.reduce(function (a, b) { return a + b; }, 0);
  return {
    visits: data.visits,
    completions: data.completions,
    users: Object.keys(data.users || {}).length,
    ratingCount: vals.length,
    ratingAvg: vals.length ? Math.round((sum / vals.length) * 10) / 10 : 0
  };
}

function userKey(name) {
  // Хеш ника + соли — в файле нет открытых имён
  return crypto.createHash('sha256').update(data.salt + '|u|' + String(name).toLowerCase().trim()).digest('hex').slice(0, 24);
}

// ---------- Вспомогательное ----------
function clientIp(req) {
  if (TRUST_PROXY) {
    const xf = req.headers['x-forwarded-for'];
    if (xf) return String(xf).split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}
const hits = new Map(); // ip -> [временные метки]
function limited(ip) {
  const now = Date.now();
  const arr = (hits.get(ip) || []).filter(function (t) { return now - t < 60000; });
  arr.push(now);
  hits.set(ip, arr);
  return arr.length > 30;
}
setInterval(function () {
  const now = Date.now();
  hits.forEach(function (arr, ip) { if (!arr.some(function (t) { return now - t < 60000; })) hits.delete(ip); });
}, 60000).unref();

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readJson(req) {
  return new Promise(function (resolve, reject) {
    let size = 0; const chunks = [];
    req.on('data', function (c) {
      size += c.length;
      if (size > 2048) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', function () {
      try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); }
      catch (e) { reject(e); }
    });
    req.on('error', reject);
  });
}

// ---------- API ----------
async function handleApi(req, res, pathname, query) {
  if (req.method === 'GET' && pathname === '/api/stats') return sendJson(res, 200, publicStats());

  if (req.method === 'GET' && pathname === '/api/admin') {
    const a = Buffer.from(String(query.get('token') || ''));
    const b = Buffer.from(ADMIN_TOKEN);
    if (!ADMIN_TOKEN || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return sendJson(res, 403, { error: 'forbidden' });
    return sendJson(res, 200, Object.assign(publicStats(), { leaves: data.leaves }));
  }

  if (req.method !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
  const ip = clientIp(req);
  if (limited(ip)) return sendJson(res, 429, { error: 'too many requests' });

  let body;
  try { body = await readJson(req); } catch (e) { return sendJson(res, 400, { error: 'bad request' }); }

  if (pathname === '/api/visit') {
    data.visits++;
    if (body.user && typeof body.user === 'string' && body.user.trim().length >= 2) {
      const uk = userKey(body.user);
      if (!data.users[uk]) data.users[uk] = { first: Date.now(), visits: 0 };
      data.users[uk].visits = (data.users[uk].visits || 0) + 1;
      data.users[uk].last = Date.now();
    }
    scheduleSave();
    return sendJson(res, 200, publicStats());
  }
  if (pathname === '/api/login') {
    const name = String(body.user || '').trim().slice(0, 32);
    if (name.length < 2) return sendJson(res, 400, { error: 'name too short' });
    const uk = userKey(name);
    if (!data.users[uk]) data.users[uk] = { first: Date.now(), visits: 0 };
    data.users[uk].visits = (data.users[uk].visits || 0) + 1;
    data.users[uk].last = Date.now();
    scheduleSave();
    return sendJson(res, 200, publicStats());
  }
  if (pathname === '/api/complete') {
    const leaf = String(body.leaf || '');
    if (!Object.prototype.hasOwnProperty.call(TREE.leaves, leaf)) return sendJson(res, 400, { error: 'unknown leaf' });
    data.completions++;
    data.leaves[leaf] = (data.leaves[leaf] || 0) + 1;
    if (body.user && typeof body.user === 'string' && body.user.trim().length >= 2) {
      const uk = userKey(body.user);
      if (!data.users[uk]) data.users[uk] = { first: Date.now(), visits: 0 };
      data.users[uk].completed = (data.users[uk].completed || 0) + 1;
      data.users[uk].last = Date.now();
    }
    scheduleSave();
    return sendJson(res, 200, publicStats());
  }
  if (pathname === '/api/rate') {
    const stars = Number(body.stars);
    if (!Number.isInteger(stars) || stars < 1 || stars > 5) return sendJson(res, 400, { error: 'stars must be 1..5' });
    // Один голос на посетителя: повторная оценка заменяет прежнюю. В файле хранится только хеш.
    const key = crypto.createHash('sha256').update(data.salt + '|' + ip + '|' + (req.headers['user-agent'] || '')).digest('hex').slice(0, 24);
    data.ratings[key] = stars; scheduleSave();
    return sendJson(res, 200, publicStats());
  }
  return sendJson(res, 404, { error: 'not found' });
}

// ---------- Статика и SEO ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8', '.xml': 'application/xml; charset=utf-8', '.json': 'application/json; charset=utf-8'
};

function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }

// Каталог профессий вставляется прямо в HTML, чтобы поисковики видели текст без выполнения скриптов.
function catalogHtml() {
  return Object.keys(TREE.domains).map(function (dk) {
    const items = Object.keys(TREE.leaves).filter(function (id) { return TREE.leaves[id].d === dk; })
      .map(function (id) { const l = TREE.leaves[id]; return '<li><b>' + esc(l.n) + '</b>. ' + esc(l.why) + '</li>'; }).join('');
    return '<h3>' + esc(TREE.domains[dk].name) + '</h3><ul>' + items + '</ul>';
  }).join('');
}

function renderIndex() {
  let html = fs.readFileSync(path.join(PUBLIC_DIR, 'index.html'), 'utf8');
  html = html.replace('<!--CATALOG-->', catalogHtml());
  if (SITE_URL) html = html.split('%SITE_URL%').join(SITE_URL);
  else html = html.split('\n').filter(function (l) { return l.indexOf('%SITE_URL%') === -1; }).join('\n');
  return html;
}

function baseHeaders(type, cache) {
  return {
    'Content-Type': type,
    'Cache-Control': cache,
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': "default-src 'self'; style-src 'self' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'"
  };
}

function serve(req, res, pathname) {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); return res.end(); }

  if (pathname === '/robots.txt') {
    const t = 'User-agent: *\nAllow: /\nDisallow: /api/\n' + (SITE_URL ? 'Sitemap: ' + SITE_URL + '/sitemap.xml\n' : '');
    res.writeHead(200, baseHeaders(MIME['.txt'], 'public, max-age=3600'));
    return res.end(req.method === 'HEAD' ? undefined : t);
  }
  if (pathname === '/sitemap.xml') {
    const today = new Date().toISOString().slice(0, 10);
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">' +
      (SITE_URL ? '<url><loc>' + SITE_URL + '/</loc><lastmod>' + today + '</lastmod></url>' : '') + '</urlset>\n';
    res.writeHead(200, baseHeaders(MIME['.xml'], 'public, max-age=3600'));
    return res.end(req.method === 'HEAD' ? undefined : xml);
  }
  if (pathname === '/' || pathname === '/index.html') {
    res.writeHead(200, baseHeaders(MIME['.html'], 'no-cache'));
    return res.end(req.method === 'HEAD' ? undefined : renderIndex());
  }

  let rel;
  try { rel = decodeURIComponent(pathname); } catch (e) { res.writeHead(400); return res.end(); }
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, function (err, buf) {
    if (err) {
      res.writeHead(404, baseHeaders(MIME['.html'], 'no-cache'));
      return res.end('<!doctype html><meta charset="utf-8"><title>Страница не найдена</title><p>Страница не найдена. <a href="/">На главную</a></p>');
    }
    res.writeHead(200, baseHeaders(MIME[path.extname(file)] || 'application/octet-stream', 'public, max-age=3600'));
    res.end(req.method === 'HEAD' ? undefined : buf);
  });
}

const server = http.createServer(function (req, res) {
  const u = new URL(req.url, 'http://localhost');
  if (u.pathname.startsWith('/api/')) {
    handleApi(req, res, u.pathname, u.searchParams).catch(function (e) {
      console.error(e); sendJson(res, 500, { error: 'server error' });
    });
  } else serve(req, res, u.pathname);
});

server.listen(PORT, function () {
  console.log('Профессия будущего: http://localhost:' + PORT + (SITE_URL ? '  (SITE_URL=' + SITE_URL + ')' : '  (SITE_URL не задан: canonical и sitemap отключены)'));
});
