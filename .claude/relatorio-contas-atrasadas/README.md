# 🔴 Relatório de Contas a Receber Atrasadas → Slack

Rotina que varre **todas as empresas Omie** configuradas, coleta os títulos com
status **ATRASADO**, organiza **por empresa e por data de vencimento** e envia um
resumo na **DM do Slack do Gabriel Almeida**.

## Empresas cobertas
- Seazone Serviços
- Seazone Gestão de Obras
- Seazone Decor
- Khanto Reservas
- Seazone Investimentos

## Como rodar manualmente

```bash
# Preview (não envia) — usa a data de hoje como referência
node relatorio.js --preview

# Preview com data de referência específica (afeta o cálculo de "dias de atraso")
node relatorio.js --preview --ref=2026-06-15

# Enviar a DM no Slack (precisa das variáveis de ambiente abaixo)
SLACK_BOT_TOKEN=xoxb-... SLACK_USER_ID=U03MN9521Q9 node relatorio.js --send
```

## Variáveis de ambiente
| Variável | Para quê |
|---|---|
| `OMIE_APPS` | JSON com as credenciais das empresas (alternativa ao `empresas.json`). Usado na nuvem (Render). |
| `SLACK_BOT_TOKEN` | Token do bot (`xoxb-...`) com escopos `chat:write` e `im:write`. |
| `SLACK_USER_ID` | Member ID de quem recebe a DM (Gabriel = `U03MN9521Q9`). |

## Credenciais
- **Local:** `empresas.json` (este arquivo é **gitignored** — nunca vai pro GitHub).
- **Nuvem:** variável `OMIE_APPS` (mesmo formato do `empresas.json`), configurada na Render.
- Use `empresas.exemplo.json` como modelo.

## Arquivos
| Arquivo | O quê |
|---|---|
| `relatorio.js` | Módulo principal (busca, agrupa, formata, envia). |
| `empresas.json` | Credenciais reais (local, gitignored). |
| `empresas.exemplo.json` | Modelo de configuração. |
| `ARQUITETURA.md` | Detalhes técnicos (API Omie, fluxo, campos). |
| `ROTINA.md` | Como o agendamento diário está configurado. |

## Detalhes do filtro
- Considera **apenas** títulos com `status_titulo = ATRASADO` (filtro server-side
  `filtrar_por_status: "ATRASADO"`).
- Não inclui pagamentos parciais nem títulos "a vencer".
- O Khanto Reservas pode mostrar cobranças **intercompany** (ex: contra a própria
  Seazone Serviços) — incluídas por padrão.
