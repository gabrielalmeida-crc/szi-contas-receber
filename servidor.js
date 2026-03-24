const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3737;

// ── Cache em memória (TTL 5 min) ──
const CACHE = {};
const CACHE_TTL = 5 * 60 * 1000;
function cacheKey(endpoint, data) { return endpoint + '|' + JSON.stringify(data); }
function cacheGet(key) {
  const e = CACHE[key];
  if (e && Date.now() - e.ts < CACHE_TTL) return e.data;
  if (e) delete CACHE[key];
  return null;
}
function cacheSet(key, data) { CACHE[key] = { data, ts: Date.now() }; }

const server = http.createServer((req, res) => {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(200); res.end(); return; }

  const pathname = req.url.split('?')[0];

  // ── Servir o HTML na raiz ──
  if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
    const file = path.join(__dirname, 'omie-contas-receber.html');
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(500); res.end('Erro ao ler HTML'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  // ── Health check ──
  if (req.method === 'GET' && pathname === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', uptime: process.uptime() }));
    return;
  }

  // ── Proxy Omie ──
  if (req.method === 'POST' && pathname === '/api/omie') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let payload;
      try { payload = JSON.parse(body); }
      catch { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'JSON inválido' })); return; }

      const endpoint = payload.endpoint || '/api/v1/financas/contareceber/';
      const ck = cacheKey(endpoint, payload.data);
      const cached = cacheGet(ck);
      if (cached) {
        res.writeHead(200, { 'Content-Type': 'application/json', 'X-Cache': 'HIT' });
        res.end(cached);
        return;
      }

      const postData = JSON.stringify(payload.data);

      const opts = {
        hostname: 'app.omie.com.br',
        port: 443,
        path: endpoint,
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
      };

      const omieReq = https.request(opts, omieRes => {
        let data = '';
        omieRes.on('data', chunk => { data += chunk; });
        omieRes.on('end', () => {
          if (omieRes.statusCode === 200) cacheSet(ck, data);
          res.writeHead(omieRes.statusCode, { 'Content-Type': 'application/json', 'X-Cache': 'MISS' });
          res.end(data);
        });
      });

      omieReq.on('error', e => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Erro Omie: ${e.message}` }));
      });

      omieReq.setTimeout(30000, () => { omieReq.destroy(); });
      omieReq.write(postData);
      omieReq.end();
    });
    return;
  }

  // ── Slack ──
  if (req.method === 'POST' && pathname === '/api/slack') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', () => {
      let payload;
      try { payload = JSON.parse(body); }
      catch { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'JSON inválido' })); return; }

      const SLACK_TOKEN = process.env.SLACK_BOT_TOKEN || '';
      if (!SLACK_TOKEN) { res.writeHead(500, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: false, error: 'SLACK_BOT_TOKEN não configurado no servidor' })); return; }
      const postData = JSON.stringify({
        channel: payload.channel_id,
        text: payload.message,
        mrkdwn: true
      });

      const opts = {
        hostname: 'slack.com',
        port: 443,
        path: '/api/chat.postMessage',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Authorization': `Bearer ${SLACK_TOKEN}`,
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const slackReq = https.request(opts, slackRes => {
        let data = '';
        slackRes.on('data', chunk => { data += chunk; });
        slackRes.on('end', () => {
          res.writeHead(slackRes.statusCode, { 'Content-Type': 'application/json' });
          res.end(data);
        });
      });

      slackReq.on('error', e => {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Erro Slack: ${e.message}` }));
      });

      slackReq.setTimeout(15000, () => { slackReq.destroy(); });
      slackReq.write(postData);
      slackReq.end();
    });
    return;
  }

  // ── 404 ──
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Rota não encontrada' }));
});

server.listen(PORT, () => {
  console.log(`\n  ✅ Servidor rodando em http://localhost:${PORT}\n`);
  console.log(`  Dashboard:  http://localhost:${PORT}/`);
  console.log(`  Proxy Omie: POST http://localhost:${PORT}/api/omie`);
  console.log(`  Health:     http://localhost:${PORT}/health\n`);
});
