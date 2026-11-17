'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const api = require('./api');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');
const MAX_BODY = 12 * 1024 * 1024;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2'
};

function sendJSON(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        const error = new Error('Arquivo muito grande.');
        error.status = 413;
        reject(error);
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function serveApi(req, res, url) {
  const body = await readBody(req);
  const headers = new Headers();
  if (req.headers.authorization) headers.set('authorization', req.headers.authorization);
  if (req.headers['content-type']) headers.set('content-type', req.headers['content-type']);

  const init = { method: req.method, headers };
  if (body && req.method !== 'GET' && req.method !== 'HEAD') init.body = body;

  const response = await api.handle(new Request(url, init));
  const outHeaders = {};
  response.headers.forEach((value, key) => {
    outHeaders[key] = value;
  });
  res.writeHead(response.status, outHeaders);
  res.end(Buffer.from(await response.arrayBuffer()));
}

function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendJSON(res, 405, { erro: 'Método não permitido.' });
  }

  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch (_) {
    return sendJSON(res, 400, { erro: 'Caminho inválido.' });
  }

  if (pathname === '/') pathname = '/index.html';

  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    return sendJSON(res, 403, { erro: 'Acesso negado.' });
  }

  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      if (path.extname(pathname)) {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        return res.end('Não encontrado');
      }
      const fallback = path.join(PUBLIC_DIR, 'index.html');
      fs.readFile(fallback, (err2, data) => {
        if (err2) {
          res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
          return res.end('Não encontrado');
        }
        res.writeHead(200, {
          'Content-Type': MIME['.html'],
          'Cache-Control': 'no-store'
        });
        res.end(req.method === 'HEAD' ? undefined : data);
      });
      return;
    }

    const ext = path.extname(filePath).toLowerCase();
    const type = MIME[ext] || 'application/octet-stream';
    res.writeHead(200, {
      'Content-Type': type,
      'Content-Length': stat.size,
      'Cache-Control': ext === '.html' ? 'no-store' : 'no-cache'
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(filePath)
      .on('error', () => res.end())
      .pipe(res);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://' + (req.headers.host || 'localhost'));

  try {
    if (url.pathname.startsWith('/api/')) {
      await serveApi(req, res, url);
      return;
    }
    serveStatic(req, res, url);
  } catch (err) {
    const status = err && err.status ? err.status : 500;
    if (!res.headersSent) {
      sendJSON(res, status, { erro: err.message || 'Erro interno.', code: err.code || null });
    } else {
      res.end();
    }
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Porta ${PORT} já está em uso. Defina outra com PORT=xxxx.`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`Meu Controle 2.0 rodando em http://${HOST}:${PORT}`);
  console.log('Banco de dados: Netlify Database (Postgres)');
});
