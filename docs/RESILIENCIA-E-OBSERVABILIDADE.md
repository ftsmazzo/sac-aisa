# Resiliência, backup e observabilidade

## Controle de backup no SAC (cliente)

No app: **Admin → saúde e backups** (master com permissão `admin.backup`):

1. Vê o **último backup** e a **lista** de dumps no servidor.
2. Clica **Gerar backup agora** → `pg_dump` grava `sac-YYYYMMDD-HHMMSS.dump` em `/data/backups`.
3. Clica **Baixar** na linha desejada.
4. Cron interno da API: dump automático **diário às 03:00** (`BACKUP_CRON=0` desliga).

O `.dump` cobre o **Postgres**. Fotos/anexos ficam no volume de uploads — faça backup desse volume no EasyPanel também.

Isso é a garantia visível para o cliente. Os arquivos ficam no volume `backups` da API (não somem no download do browser).

Restore de um `.dump` (ops):

```bash
pg_restore --clean --if-exists --no-owner --dbname="$DATABASE_URL" sac-XXXXXXXX-XXXXXX.dump
```

Faça restore preferencialmente num Postgres de teste, nunca no principal sem validar.

Retenção local: últimos 20 dumps (`BACKUP_RETENTION`).

## EasyPanel (camada extra)

Agenda noturna do Postgres + volume `anexos` no projeto `sac-aisa` (painel). Complementa o controle do Admin; não substitui a lista no app.

## JSON legado (Dropbox)

Export/import JSON na aba Dados é resquício da versão Dropbox: incompleto (sem senhas, sem WhatsApp, fotos só metadado). **Não use como backup oficial.**

## Redis

- Variável: `REDIS_URL=redis://<host-interno>:6379`
- Se faltar, a API sobe e a fila usa `fila_tarefas` no Postgres.

## Uptime Kuma

- URL: `https://sac-aisa-api.se860g.easypanel.host/health`
- Keyword/JSON: `"ok":true`

## Glitchtip

- `SENTRY_DSN` na API. Nos logs: `Glitchtip/Sentry ativo`.
