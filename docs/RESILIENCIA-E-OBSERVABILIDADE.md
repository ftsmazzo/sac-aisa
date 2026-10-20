# Resiliência, backup e observabilidade

## Restore em banco secundário

Não é besteira. É o jeito certo.

1. Mantenha o Postgres principal (`sac_aisa`) só para produção.
2. Crie no EasyPanel um segundo Postgres (ou use o serviço `postgres_restore` do compose com profile `restore`).
3. Gere o backup pelo Admin → **Backup agora** (JSON operacional) e/ou o snapshot diário do EasyPanel.
4. Restaure **só** no banco secundário e valide login, lista de reclamações e um KPI.
5. Só depois, se estiver certo, planeje a troca do principal em janela curta.

Nunca teste restore apontando a API de produção para o banco de restore.

## Redis

- Variável: `REDIS_URL=redis://<host-interno>:6379`
- Se faltar, a API sobe normalmente e a fila usa só a tabela `fila_tarefas` no Postgres.
- No EasyPanel: crie um serviço Redis no mesmo projeto do SAC e cole a URL interna na API.

## Uptime Kuma

Vale a pena. Configure um monitor HTTP(s):

- URL: `https://<sua-api>/health`
- Método: GET
- Intervalo: 60s
- Keyword ou JSON: `"ok":true`

Se `checks.db` vier `erro`, o health ainda responde, mas `ok` fica `false` — o Kuma alerta.

## Glitchtip

Vale a pena na API. É o Sentry open-source que você já usa em outros projetos.

1. Crie um projeto no Glitchtip para o SAC.
2. Copie o DSN para `SENTRY_DSN` na API (próxima onda pode ligar o SDK; a variável já está reservada).
3. Use para erros 500, falhas de LLM e webhook — não para métricas de uptime (isso é Kuma).

## Backup fácil

- Botão **Backup agora** (master, Admin): baixa JSON com usuários (sem hash), reclamações, produtos, vendas, configs e permissões.
- Mantenha também o backup automático do volume Postgres no EasyPanel (7 diários + 4 semanais).
