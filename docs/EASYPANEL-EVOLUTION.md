# Deploy EasyPanel + Evolution API

## 1. Postgres (EasyPanel)

Crie um serviço PostgreSQL no EasyPanel e anote:

```
DATABASE_URL=postgresql://USER:PASSWORD@HOST:5432/sac_aisa?schema=public
```

Crie também um database `evolution` no mesmo Postgres (ou use outro serviço) para a Evolution API.

## 2. API SAC

- Build: `apps/api/Dockerfile`
- Porta: `3001`
- Env mínimas:
  - `DATABASE_URL`
  - `JWT_SECRET`
  - `CORS_ORIGIN` (URL do web)
  - `PUBLIC_API_URL` (URL pública da API)
  - `EVOLUTION_API_URL` (URL interna/pública da Evolution)
  - `EVOLUTION_API_KEY`
  - `EVOLUTION_INSTANCE=sac-aisa`
  - `EVOLUTION_WEBHOOK_SECRET`
  - `OPENAI_API_KEY` (opcional)

No primeiro boot o container roda `prisma migrate deploy` + seed (importa `data/sac_backup_ultimo.json` se existir).

## 3. Web SAC

- Build: `apps/web/Dockerfile`
- Arg/env: `NEXT_PUBLIC_API_URL` = URL pública da API
- Porta: `3000`

## 4. Evolution API

Opções:

**A)** Serviço no mesmo `docker-compose.yml` (`evolution`)  
**B)** App separado no EasyPanel com imagem `atendai/evolution-api:v2.2.3`

Env sugeridas:

```
SERVER_URL=https://evolution.seu-dominio
AUTHENTICATION_API_KEY=<mesma EVOLUTION_API_KEY>
DATABASE_ENABLED=true
DATABASE_PROVIDER=postgresql
DATABASE_CONNECTION_URI=postgresql://USER:PASSWORD@HOST:5432/evolution?schema=public
```

### Configurar instância e webhook

1. Crie a instância `sac-aisa` na Evolution e escaneie o QR.
2. Webhook da instância:

```
POST https://api.seu-dominio/whatsapp/webhook/evolution
```

Eventos: `MESSAGES_UPSERT`  
Header: `x-evolution-secret: <EVOLUTION_WEBHOOK_SECRET>`

Ou chame autenticado:

```
POST /whatsapp/evolution/configure-webhook
```

## 5. Alertas internos

Cadastre destinos WhatsApp:

```
POST /alertas/destinos
{ "nome": "Expedição", "setor": "Embalagem / Expedição", "telefone": "5511999999999" }
```

Gestores podem receber todos os alertas com `perfil: "gestor"` e `setor: ""`.

## 6. Fluxo cliente WhatsApp

- `MENU` / `OI` — menu
- `NOVA` — abre rascunho de reclamação
- `STATUS 402` — consulta situação (respeita devolução/tratativa)
- `ATENDENTE` — handoff humano
