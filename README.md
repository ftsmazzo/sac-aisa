# SAC AISA em nuvem

Modernização do SAC interno (HTML + JSON) para nuvem com:

- **Postgres** (implantação no **EasyPanel**)
- **Next.js** (web) + **NestJS** (API) + **Prisma**
- **IA** de classificação (legado + LLM opcional)
- **Alertas inteligentes** (jobs + painel + WhatsApp interno)
- **Evolution API** para WhatsApp (cliente + interno)

## Regras de negócio preservadas

- Situação: `dataAcao` → resolvida; sem ação + `AGUARDANDO` → aguardando produto; senão → tratativa
- Tratativa só após produto recebido (ou sem devolução)
- Causa → setor responsável (override manual)
- Custo = soma fretes + peça + estorno + desconto + guia

## Estrutura

```
apps/api          NestJS + Prisma
apps/web          Next.js
packages/domain   Regras compartilhadas + testes
data/             Backup JSON para seed/import
docker-compose.yml  Postgres + API + Web + Evolution
```

## Dados iniciais (migration)

A migration `apps/api/prisma/migrations/20261017000000_seed_dados_iniciais` carrega:

- **319 produtos** do SEED do HTML
- **22 causas** de direcionamento
- **4 usuários** + configs do JSON
- **402 reclamações** + **87 eventos** de auditoria do backup

Para regenerar (com o JSON local em `data/`):

```bash
node scripts/generate-seed-migration.js
```

## Desenvolvimento local

```bash
cp .env.example .env
# Suba o Postgres (Docker ou EasyPanel) e ajuste DATABASE_URL

npm install
npm run build -w @sac-aisa/domain
cd apps/api && npx prisma generate && npx prisma migrate deploy && npx tsx prisma/seed.ts
npm run dev:api
npm run dev:web
```

Login seed: `admin` / `sac1234`  
Usuários do backup legado continuam com a senha original (hash SHA-256 migrado para bcrypt no primeiro login).

## EasyPanel

1. Crie um serviço **Postgres** e copie a `DATABASE_URL`.
2. Deploy da **API** (`apps/api/Dockerfile`) com as variáveis de `.env.example`.
3. Deploy do **Web** (`apps/web/Dockerfile`) com `NEXT_PUBLIC_API_URL` apontando para a API.
4. Deploy da **Evolution API** (imagem `atendai/evolution-api`) usando o mesmo Postgres (database `evolution`) ou o compose.
5. Na Evolution, crie a instância `sac-aisa`, conecte o WhatsApp e configure o webhook:

   `POST {PUBLIC_API_URL}/whatsapp/webhook/evolution`

   Header opcional: `x-evolution-secret` = `EVOLUTION_WEBHOOK_SECRET`

## WhatsApp (Evolution)

- Cliente: MENU / NOVA / STATUS {nº} / ATENDENTE
- Rascunhos entram com `origem=whatsapp` e `rascunho=true` para o SAC confirmar
- Interno: destinos em `GET/POST /alertas/destinos` recebem alertas via Evolution

## IA

- Sem `OPENAI_API_KEY`: usa só o classificador legado (regras do HTML)
- Com chave: LLM + fallback/auditoria (`fonte: legado | llm | manual`)
