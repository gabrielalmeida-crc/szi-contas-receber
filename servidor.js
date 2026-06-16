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

  // ── Servir a página de Consulta de NFs ──
  if (req.method === 'GET' && (pathname === '/nfs' || pathname === '/consulta-nfs.html')) {
    const file = path.join(__dirname, 'consulta-nfs.html');
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(500); res.end('Erro ao ler HTML'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  // ── Proxy CSV da planilha (Google Sheets publicado) ──
  // Evita CORS no navegador. Aceita ?url= (apenas docs.google.com) ou usa SHEET_CSV_URL.
  if (req.method === 'GET' && pathname === '/api/sheet') {
    const u = new URL(req.url, `http://${req.headers.host}`);
    const target = u.searchParams.get('url') || process.env.SHEET_CSV_URL || '';
    let parsed;
    try { parsed = new URL(target); } catch { res.writeHead(400, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'URL inválida' })); return; }
    if (parsed.hostname !== 'docs.google.com' && parsed.hostname !== 'docs.googleusercontent.com') {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'Host não permitido (apenas docs.google.com)' }));
      return;
    }
    const ck = cacheKey('sheet', target);
    const cached = cacheGet(ck);
    if (cached) { res.writeHead(200, { 'Content-Type': 'text/csv; charset=utf-8', 'X-Cache': 'HIT' }); res.end(cached); return; }

    const doGet = (urlStr, redirects) => {
      https.get(urlStr, gres => {
        if ([301,302,303,307,308].includes(gres.statusCode) && gres.headers.location && redirects < 5) {
          gres.resume();
          return doGet(new URL(gres.headers.location, urlStr).toString(), redirects + 1);
        }
        let data = '';
        gres.on('data', c => { data += c; });
        gres.on('end', () => {
          if (gres.statusCode === 200) cacheSet(ck, data);
          res.writeHead(gres.statusCode, { 'Content-Type': 'text/csv; charset=utf-8', 'X-Cache': 'MISS' });
          res.end(data);
        });
      }).on('error', e => {
        res.writeHead(502, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: `Erro ao buscar planilha: ${e.message}` }));
      });
    };
    doGet(target, 0);
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

  // ── Relatório de Contas a Receber ATRASADAS (multi-empresa → Slack DM) ──
  // POST /api/relatorio-atrasados   body/query: { dry: true|1 } para preview sem enviar
  // Protegido por TRIGGER_TOKEN (se definido na env): ?token=... ou body.token
  if (req.method === 'POST' && pathname === '/api/relatorio-atrasados') {
    let body = '';
    req.on('data', chunk => { body += chunk; });
    req.on('end', async () => {
      let payload = {};
      try { payload = body ? JSON.parse(body) : {}; } catch { payload = {}; }
      const q = new URL(req.url, `http://${req.headers.host}`).searchParams;
      const token = payload.token || q.get('token');
      const dry = payload.dry === true || payload.dry === 1 || q.get('dry') === '1';

      const TRIGGER = process.env.TRIGGER_TOKEN || '';
      if (TRIGGER && token !== TRIGGER) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: 'token inválido' }));
        return;
      }

      try {
        const { gerarRelatorio, enviarSlackDM } = require('./.claude/relatorio-contas-atrasadas/relatorio.js');
        const ref = payload.ref || q.get('ref') || null;
        const { texto, empresas } = await gerarRelatorio(ref);
        const qtd = empresas.reduce((s, e) => s + e.titulos.length, 0);

        if (dry) {
          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: true, dry: true, titulos: qtd, texto }));
          return;
        }

        const slackToken = process.env.SLACK_BOT_TOKEN;
        const userId = process.env.SLACK_USER_ID;
        if (!slackToken || !userId) throw new Error('SLACK_BOT_TOKEN ou SLACK_USER_ID não configurado');
        await enviarSlackDM(slackToken, userId, texto);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ ok: true, enviado: true, titulos: qtd }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ ok: false, error: e.message }));
      }
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
  console.log(`  Consulta NF: http://localhost:${PORT}/nfs`);
  console.log(`  Proxy Omie: POST http://localhost:${PORT}/api/omie`);
  console.log(`  Health:     http://localhost:${PORT}/health\n`);
});
