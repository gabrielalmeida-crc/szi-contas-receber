# Arquitetura técnica

## Fluxo

```
Agendador diário (manhã)
   │
   ▼
relatorio.js  (gerarRelatorio)
   │
   ├─ Para CADA empresa (empresas.json / OMIE_APPS):
   │     ├─ ListarContasReceber  filtrar_por_status: "ATRASADO"  (paginado, 500/pág)
   │     └─ ConsultarCliente      por código (resolve nome, com cache)
   │
   ├─ Agrupa: empresa → data de vencimento (asc) → títulos (valor desc)
   ├─ Calcula dias de atraso = data_referência − data_vencimento
   └─ Monta texto mrkdwn
         │
         ▼
   enviarSlackDM:  conversations.open(users) → chat.postMessage(channel, text)
```

## API Omie — pontos validados (16/06/2026)
- Endpoint: `POST https://app.omie.com.br/api/v1/financas/contareceber/`
- **Filtro de status correto:** `filtrar_por_status: "ATRASADO"`
  (⚠️ NÃO existe `filtrar_por_status_de_titulo` — retorna erro de tag).
- `registros_por_pagina`: até **500**. Resposta traz `total_de_paginas` para paginar.
- Sem o filtro de status, uma empresa pode ter dezenas de milhares de títulos —
  por isso o filtro server-side é **obrigatório**.
- Campos por título:
  - `data_vencimento` → `dd/mm/aaaa` (precisa converter).
  - `status_titulo` → `"ATRASADO"`.
  - `codigo_cliente_fornecedor` → resolver via `ConsultarCliente`.
  - `valor_documento` → valor do título.
  - `numero_documento_fiscal` (NF) / `numero_documento` (Doc) → nem sempre presentes;
    fallback para `#codigo_lancamento_omie`.
- Clientes: `POST /api/v1/geral/clientes/` call `ConsultarCliente`,
  param `codigo_cliente_omie`. Nome = `nome_fantasia` ou `razao_social`.

## Rate limit
- `sleep(300ms)` entre páginas e `sleep(250ms)` entre consultas de cliente
  para respeitar o limite da Omie.

## Slack
- Bot precisa dos escopos **`chat:write`** e **`im:write`**.
- DM: `conversations.open({users: SLACK_USER_ID})` → pega `channel.id` →
  `chat.postMessage({channel, text, mrkdwn:true})`.
- Token (`xoxb-...`) fica na env `SLACK_BOT_TOKEN` (Render), nunca no código.

## Segurança
- `empresas.json` (credenciais reais) é **gitignored**.
- Em produção (Render) as credenciais vêm da env `OMIE_APPS`.
- O repositório `szi-contas-receber` é **público** — por isso nenhum segredo
  pode ser commitado.
