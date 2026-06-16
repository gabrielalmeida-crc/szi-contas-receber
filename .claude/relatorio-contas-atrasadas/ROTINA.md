# Rotina diária — agendamento

## Quando
- **08:00 (horário de Brasília), dias úteis (seg–sex).**
- Em UTC isso é **11:00** (BRT = UTC−3).

## Como funciona
```
Agente agendado (nuvem, 08:00 BRT seg–sex)
        │  POST com TRIGGER_TOKEN
        ▼
https://szi-contas-receber.onrender.com/api/relatorio-atrasados
        │  (servidor.js na Render — já tem SLACK_BOT_TOKEN, OMIE_APPS, SLACK_USER_ID)
        ├─ gerarRelatorio() varre as 5 empresas, filtra ATRASADO, agrupa
        └─ enviarSlackDM() → DM do Gabriel (U03MN9521Q9)
```

## Endpoint
`POST https://szi-contas-receber.onrender.com/api/relatorio-atrasados`

| Param | Efeito |
|---|---|
| `token` | Obrigatório (= env `TRIGGER_TOKEN` na Render). Sem ele → 401. |
| `dry=1` | Só retorna o texto (preview JSON), **não envia** a DM. |
| `ref=AAAA-MM-DD` | Data de referência p/ cálculo de dias de atraso (default: hoje). |

### Exemplos
```bash
# Preview (não envia)
curl -X POST "https://szi-contas-receber.onrender.com/api/relatorio-atrasados?dry=1&token=SEU_TRIGGER_TOKEN"

# Disparo real (envia a DM)
curl -X POST "https://szi-contas-receber.onrender.com/api/relatorio-atrasados?token=SEU_TRIGGER_TOKEN"
```

## Variáveis na Render (já configuradas)
- `SLACK_BOT_TOKEN` — bot (`xoxb-...`).
- `SLACK_USER_ID` — `U03MN9521Q9` (Gabriel).
- `OMIE_APPS` — JSON das 5 empresas.
- `TRIGGER_TOKEN` — segredo que protege o endpoint.

## Manutenção
- **Nova empresa:** atualizar `empresas.json` (local) **e** a env `OMIE_APPS` na Render.
- **Trocar horário/dias:** editar o agente agendado (skill `/schedule`).
- **Trocar destinatário:** alterar `SLACK_USER_ID` na Render.
- O `TRIGGER_TOKEN` nunca deve ser commitado; fica só na Render e no agente agendado.
