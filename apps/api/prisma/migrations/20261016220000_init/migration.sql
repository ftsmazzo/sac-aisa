-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Perfil" AS ENUM ('master', 'gestor', 'operador');
CREATE TYPE "Devolucao" AS ENUM ('NA', 'AGUARDANDO', 'RECEBIDO');
CREATE TYPE "Situacao" AS ENUM ('aguardando', 'tratativa', 'resolvida');
CREATE TYPE "ProdutoStatus" AS ENUM ('ATIVO', 'INATIVO');
CREATE TYPE "AlertTipo" AS ENUM ('AGUARDANDO_DIAS', 'TRATATIVA_META', 'RECORRENCIA', 'CUSTO_ALTO', 'CAUSA_OUTROS', 'RASCUNHO_WHATSAPP');
CREATE TYPE "AlertStatus" AS ENUM ('aberto', 'enviado', 'resolvido', 'ignorado');
CREATE TYPE "WhatsappDirecao" AS ENUM ('inbound', 'outbound');
CREATE TYPE "WhatsappPapel" AS ENUM ('cliente', 'interno');

CREATE TABLE "usuarios" (
    "id" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "perfil" "Perfil" NOT NULL,
    "salt" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "telefone" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoPor" TEXT,
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "usuarios_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "usuarios_login_key" ON "usuarios"("login");

CREATE TABLE "produtos" (
    "id" TEXT NOT NULL,
    "cod" TEXT NOT NULL,
    "produto" TEXT NOT NULL,
    "setor" TEXT NOT NULL DEFAULT '',
    "status" "ProdutoStatus" NOT NULL DEFAULT 'ATIVO',
    "categoria" TEXT NOT NULL DEFAULT '',
    "familia" TEXT NOT NULL DEFAULT '',
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "produtos_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "produtos_cod_key" ON "produtos"("cod");

CREATE TABLE "sku_depara" (
    "id" TEXT NOT NULL,
    "skuOrigem" TEXT NOT NULL,
    "skuDestino" TEXT NOT NULL,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sku_depara_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sku_depara_skuOrigem_key" ON "sku_depara"("skuOrigem");

CREATE TABLE "causas" (
    "id" TEXT NOT NULL,
    "cat" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "setor" TEXT NOT NULL,
    "acao" TEXT NOT NULL,
    "ordem" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "causas_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "regras_direcionamento" (
    "id" TEXT NOT NULL,
    "causaId" TEXT NOT NULL,
    "setor" TEXT,
    "acao" TEXT,
    CONSTRAINT "regras_direcionamento_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "regras_direcionamento_causaId_key" ON "regras_direcionamento"("causaId");

CREATE TABLE "reclamacoes" (
    "id" TEXT NOT NULL,
    "reg" INTEGER NOT NULL,
    "data" TEXT,
    "empresa" TEXT NOT NULL DEFAULT '',
    "setor" TEXT NOT NULL DEFAULT '',
    "sku" TEXT NOT NULL DEFAULT '',
    "produto" TEXT NOT NULL DEFAULT '',
    "familia" TEXT NOT NULL DEFAULT '',
    "garantia" TEXT NOT NULL DEFAULT '',
    "canal" TEXT NOT NULL DEFAULT '',
    "protocolo" TEXT NOT NULL DEFAULT '',
    "cliente" TEXT NOT NULL DEFAULT '',
    "cidade" TEXT NOT NULL DEFAULT '',
    "uf" TEXT NOT NULL DEFAULT '',
    "reclamacao" TEXT NOT NULL DEFAULT '',
    "laudo" TEXT NOT NULL DEFAULT '',
    "procedencia" TEXT NOT NULL DEFAULT '',
    "solucao" TEXT NOT NULL DEFAULT '',
    "dataAcao" TEXT,
    "obs" TEXT NOT NULL DEFAULT '',
    "transp" TEXT NOT NULL DEFAULT '',
    "freteEnvio" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "freteRetorno" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "valorPeca" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "estorno" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "desconto" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "guia" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "devolucao" "Devolucao" NOT NULL DEFAULT 'NA',
    "dataRecebimento" TEXT,
    "causaId" TEXT NOT NULL DEFAULT '',
    "causaManual" BOOLEAN NOT NULL DEFAULT false,
    "obsCausa" TEXT NOT NULL DEFAULT '',
    "setorRespManual" TEXT NOT NULL DEFAULT '',
    "peca" TEXT NOT NULL DEFAULT '',
    "situacao" "Situacao" NOT NULL DEFAULT 'tratativa',
    "origem" TEXT NOT NULL DEFAULT 'web',
    "whatsappTelefone" TEXT,
    "rascunho" BOOLEAN NOT NULL DEFAULT false,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoPor" TEXT,
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    "alteradoPor" TEXT,
    CONSTRAINT "reclamacoes_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "reclamacoes_reg_key" ON "reclamacoes"("reg");
CREATE INDEX "reclamacoes_situacao_idx" ON "reclamacoes"("situacao");
CREATE INDEX "reclamacoes_data_idx" ON "reclamacoes"("data");
CREATE INDEX "reclamacoes_empresa_idx" ON "reclamacoes"("empresa");
CREATE INDEX "reclamacoes_canal_idx" ON "reclamacoes"("canal");

CREATE TABLE "reclamacao_fotos" (
    "id" TEXT NOT NULL,
    "reclamacaoId" TEXT NOT NULL,
    "nome" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "miniPath" TEXT,
    "width" INTEGER,
    "height" INTEGER,
    "kb" INTEGER,
    "descricaoIa" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoPor" TEXT,
    CONSTRAINT "reclamacao_fotos_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "reclamacao_fotos" ADD CONSTRAINT "reclamacao_fotos_reclamacaoId_fkey" FOREIGN KEY ("reclamacaoId") REFERENCES "reclamacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "auditoria" (
    "id" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "user" TEXT NOT NULL,
    "nome" TEXT NOT NULL DEFAULT '',
    "perfil" TEXT NOT NULL DEFAULT '',
    "acao" TEXT NOT NULL,
    "alvo" TEXT NOT NULL DEFAULT '',
    "detalhe" TEXT NOT NULL DEFAULT '',
    "recId" TEXT,
    "extra" JSONB,
    CONSTRAINT "auditoria_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "auditoria_ts_idx" ON "auditoria"("ts");
CREATE INDEX "auditoria_recId_idx" ON "auditoria"("recId");

CREATE TABLE "config" (
    "chave" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    CONSTRAINT "config_pkey" PRIMARY KEY ("chave")
);

CREATE TABLE "alertas" (
    "id" TEXT NOT NULL,
    "tipo" "AlertTipo" NOT NULL,
    "status" "AlertStatus" NOT NULL DEFAULT 'aberto',
    "titulo" TEXT NOT NULL,
    "mensagem" TEXT NOT NULL,
    "reclamacaoId" TEXT,
    "chaveDedupe" TEXT NOT NULL,
    "setorResp" TEXT,
    "enviadoEm" TIMESTAMP(3),
    "resolvidoEm" TIMESTAMP(3),
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "meta" JSONB,
    CONSTRAINT "alertas_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "alertas_chaveDedupe_key" ON "alertas"("chaveDedupe");
CREATE INDEX "alertas_status_tipo_idx" ON "alertas"("status", "tipo");
ALTER TABLE "alertas" ADD CONSTRAINT "alertas_reclamacaoId_fkey" FOREIGN KEY ("reclamacaoId") REFERENCES "reclamacoes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "alerta_destinos" (
    "id" TEXT NOT NULL,
    "setor" TEXT NOT NULL DEFAULT '',
    "perfil" TEXT NOT NULL DEFAULT '',
    "telefone" TEXT NOT NULL,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "nome" TEXT NOT NULL DEFAULT '',
    CONSTRAINT "alerta_destinos_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "whatsapp_conversas" (
    "id" TEXT NOT NULL,
    "telefone" TEXT NOT NULL,
    "papel" "WhatsappPapel" NOT NULL DEFAULT 'cliente',
    "nome" TEXT NOT NULL DEFAULT '',
    "estado" TEXT NOT NULL DEFAULT 'inicio',
    "contexto" JSONB,
    "ativo" BOOLEAN NOT NULL DEFAULT true,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "whatsapp_conversas_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "whatsapp_conversas_telefone_idx" ON "whatsapp_conversas"("telefone");

CREATE TABLE "whatsapp_mensagens" (
    "id" TEXT NOT NULL,
    "conversaId" TEXT NOT NULL,
    "direcao" "WhatsappDirecao" NOT NULL,
    "texto" TEXT NOT NULL,
    "payload" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "whatsapp_mensagens_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "whatsapp_mensagens" ADD CONSTRAINT "whatsapp_mensagens_conversaId_fkey" FOREIGN KEY ("conversaId") REFERENCES "whatsapp_conversas"("id") ON DELETE CASCADE ON UPDATE CASCADE;
