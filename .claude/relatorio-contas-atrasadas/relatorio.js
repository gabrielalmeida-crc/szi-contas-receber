/**
 * Relatório de Contas a Receber ATRASADAS — multi-empresa Omie → Slack DM
 *
 * Varre todas as empresas configuradas (OMIE_APPS env ou empresas.json),
 * busca títulos com status ATRASADO, agrupa por empresa e por data de
 * vencimento, e monta uma mensagem formatada para o Slack.
 *
 * Uso:
 *   node relatorio.js --preview            → imprime o texto (não envia)
 *   node relatorio.js --send               → envia DM (precisa SLACK_BOT_TOKEN + SLACK_USER_ID)
 *   node relatorio.js --preview --ref=2026-06-15   → usa data de referência (dias de atraso)
 *
 * Também é importável: const { gerarRelatorio, enviarSlackDM } = require('./relatorio');
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

// ───────────────────────── Config ─────────────────────────
function carregarEmpresas() {
  if (process.env.OMIE_APPS) {
    try { return JSON.parse(process.env.OMIE_APPS); }
    catch (e) { throw new Error('OMIE_APPS não é um JSON válido: ' + e.message); }
  }
  const f = path.join(__dirname, 'empresas.json');
  if (fs.existsSync(f)) return JSON.parse(fs.readFileSync(f, 'utf8'));
  throw new Error('Sem credenciais: defina a env OMIE_APPS ou crie empresas.json');
}

// ───────────────────────── HTTP helper ─────────────────────────
function httpsPost(hostname, pathName, bodyObj) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(bodyObj);
    const req = https.request({
      hostname, port: 443, path: pathName, method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
    }, res => {
      let buf = '';
      res.on('data', c => { buf += c; });
      res.on('end', () => {
        try { resolve(JSON.parse(buf)); }
        catch { reject(new Error('Resposta não-JSON de ' + hostname + ': ' + buf.slice(0, 200))); }
      });
    });
    req.on('error', reject);
    req.setTimeout(30000, () => req.destroy(new Error('timeout ' + hostname)));
    req.write(data); req.end();
  });
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ───────────────────────── Omie ─────────────────────────
function omie(call, app, param) {
  return httpsPost('app.omie.com.br', '/api/v1/financas/contareceber/', {
    call, app_key: app.app_key, app_secret: app.app_secret, param: [param]
  });
}
function omieCliente(app, codigo) {
  return httpsPost('app.omie.com.br', '/api/v1/geral/clientes/', {
    call: 'ConsultarCliente', app_key: app.app_key, app_secret: app.app_secret,
    param: [{ codigo_cliente_omie: codigo }]
  });
}

/** Busca todos os títulos ATRASADO de uma empresa (paginado). */
async function buscarAtrasados(app) {
  const titulos = [];
  let pagina = 1, totalPaginas = 1;
  do {
    const r = await omie('ListarContasReceber', app, {
      pagina, registros_por_pagina: 500, filtrar_por_status: 'ATRASADO'
    });
    if (r.faultstring) {
      // Sem títulos atrasados a API pode retornar erro "não há registros"
      if (/não.*registros|nenhum/i.test(r.faultstring)) break;
      throw new Error(`Omie [${app.nome}]: ${r.faultstring}`);
    }
    totalPaginas = r.total_de_paginas || 1;
    (r.conta_receber_cadastro || []).forEach(t => titulos.push(t));
    pagina++;
    if (pagina <= totalPaginas) await sleep(300); // respeitar rate limit Omie
  } while (pagina <= totalPaginas);
  return titulos;
}

/** Resolve nomes de clientes (com cache por empresa). */
async function resolverClientes(app, codigos) {
  const mapa = {};
  for (const cod of codigos) {
    try {
      const c = await omieCliente(app, cod);
      mapa[cod] = c.nome_fantasia || c.razao_social || ('Cliente ' + cod);
    } catch { mapa[cod] = 'Cliente ' + cod; }
    await sleep(250);
  }
  return mapa;
}

// ───────────────────────── Utils ─────────────────────────
const MESES = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'];
function brl(v) { return 'R$ ' + Number(v || 0).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
function parseBR(d) { const [dia, mes, ano] = (d || '').split('/').map(Number); return new Date(ano, mes - 1, dia); }
function diasAtraso(vencBR, ref) { return Math.max(0, Math.round((ref - parseBR(vencBR)) / 86400000)); }
function docLabel(t) {
  if (t.numero_documento_fiscal) return 'NF ' + t.numero_documento_fiscal;
  if (t.numero_documento) return 'Doc ' + t.numero_documento;
  return '#' + t.codigo_lancamento_omie;
}

// ───────────────────────── Núcleo ─────────────────────────
async function gerarRelatorio(refDate) {
  const ref = refDate ? new Date(refDate + 'T12:00:00') : new Date();
  const empresas = carregarEmpresas();
  const resultado = [];

  for (const app of empresas) {
    const titulos = await buscarAtrasados(app);
    const codigos = [...new Set(titulos.map(t => t.codigo_cliente_fornecedor))];
    const nomes = await resolverClientes(app, codigos);
    const total = titulos.reduce((s, t) => s + (t.valor_documento || 0), 0);
    resultado.push({ nome: app.nome, titulos, nomes, total });
  }

  return { ref, empresas: resultado, texto: formatarSlack(resultado, ref) };
}

function formatarSlack(empresas, ref) {
  const dataRef = `${String(ref.getDate()).padStart(2,'0')}/${String(ref.getMonth()+1).padStart(2,'0')}/${ref.getFullYear()}`;
  const totalGeral = empresas.reduce((s, e) => s + e.total, 0);
  const qtdGeral = empresas.reduce((s, e) => s + e.titulos.length, 0);
  const comAtraso = empresas.filter(e => e.titulos.length > 0);

  let txt = `🔴 *Contas a Receber — ATRASADAS*\n`;
  txt += `_Referência: ${dataRef}_\n\n`;
  txt += `📊 *GERAL:* ${brl(totalGeral)} · ${qtdGeral} título(s) · ${comAtraso.length} empresa(s)\n`;

  if (qtdGeral === 0) { txt += `\n✅ Nenhum título atrasado. Tudo em dia!`; return txt; }

  for (const e of empresas) {
    if (!e.titulos.length) continue;
    txt += `\n━━ *${e.nome}* ━━  (${brl(e.total)} · ${e.titulos.length})\n`;
    // agrupar por data de vencimento (asc)
    const porData = {};
    e.titulos.forEach(t => { (porData[t.data_vencimento] = porData[t.data_vencimento] || []).push(t); });
    const datas = Object.keys(porData).sort((a, b) => parseBR(a) - parseBR(b));
    for (const d of datas) {
      txt += `  📅 ${d}\n`;
      porData[d]
        .sort((a, b) => (b.valor_documento || 0) - (a.valor_documento || 0))
        .forEach(t => {
          const cli = e.nomes[t.codigo_cliente_fornecedor] || ('Cliente ' + t.codigo_cliente_fornecedor);
          txt += `     • ${cli} — ${brl(t.valor_documento)} · ${diasAtraso(t.data_vencimento, ref)}d · ${docLabel(t)}\n`;
        });
    }
  }
  // empresas sem atraso (resumo)
  const semAtraso = empresas.filter(e => !e.titulos.length).map(e => e.nome);
  if (semAtraso.length) txt += `\n✅ Sem atrasos: ${semAtraso.join(', ')}`;
  return txt;
}

// ───────────────────────── Slack ─────────────────────────
function slackCall(token, method, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = https.request({
      hostname: 'slack.com', port: 443, path: '/api/' + method, method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Authorization': 'Bearer ' + token,
        'Content-Length': Buffer.byteLength(data)
      }
    }, res => { let b = ''; res.on('data', c => b += c); res.on('end', () => { try { resolve(JSON.parse(b)); } catch { reject(new Error(b)); } }); });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

/** Abre o DM com o usuário e envia a mensagem. */
async function enviarSlackDM(token, userId, texto) {
  const conv = await slackCall(token, 'conversations.open', { users: userId });
  if (!conv.ok) throw new Error('Slack conversations.open: ' + conv.error);
  const channel = conv.channel.id;
  const r = await slackCall(token, 'chat.postMessage', { channel, text: texto, mrkdwn: true });
  if (!r.ok) throw new Error('Slack chat.postMessage: ' + r.error);
  return r;
}

// ───────────────────────── CLI ─────────────────────────
async function main() {
  const args = process.argv.slice(2);
  const refArg = (args.find(a => a.startsWith('--ref=')) || '').split('=')[1] || null;
  const { texto } = await gerarRelatorio(refArg);

  if (args.includes('--send')) {
    const token = process.env.SLACK_BOT_TOKEN;
    const userId = process.env.SLACK_USER_ID;
    if (!token || !userId) throw new Error('Defina SLACK_BOT_TOKEN e SLACK_USER_ID para enviar.');
    await enviarSlackDM(token, userId, texto);
    console.log('✅ Relatório enviado no Slack.');
  } else {
    console.log('\n──────── PREVIEW (não enviado) ────────\n');
    console.log(texto);
    console.log('\n───────────────────────────────────────');
  }
}

if (require.main === module) {
  main().catch(e => { console.error('❌ ' + e.message); process.exit(1); });
}

module.exports = { gerarRelatorio, enviarSlackDM, formatarSlack };
