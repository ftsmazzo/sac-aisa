-- CreateEnum
CREATE TYPE "PlanoStatus" AS ENUM ('aberto', 'em_andamento', 'concluido', 'cancelado');

-- CreateEnum
CREATE TYPE "PlanoOrigem" AS ENUM ('kpi', 'manual', 'recorrencia');

-- CreateTable
CREATE TABLE "vendas_dia" (
    "id" TEXT NOT NULL,
    "sku" TEXT NOT NULL,
    "descricao" TEXT NOT NULL DEFAULT '',
    "data" TEXT NOT NULL,
    "qtde" INTEGER NOT NULL DEFAULT 0,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "alteradoEm" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendas_dia_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "planos_acao" (
    "id" TEXT NOT NULL,
    "titulo" TEXT NOT NULL,
    "descricao" TEXT NOT NULL DEFAULT '',
    "sku" TEXT NOT NULL DEFAULT '',
    "causaId" TEXT NOT NULL DEFAULT '',
    "setorFab" TEXT NOT NULL DEFAULT '',
    "setorResp" TEXT NOT NULL DEFAULT '',
    "status" "PlanoStatus" NOT NULL DEFAULT 'aberto',
    "prioridade" TEXT NOT NULL DEFAULT 'media',
    "responsavel" TEXT NOT NULL DEFAULT '',
    "prazo" TEXT,
    "origem" "PlanoOrigem" NOT NULL DEFAULT 'manual',
    "meta" JSONB,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "criadoPor" TEXT,
    "alteradoEm" TIMESTAMP(3) NOT NULL,
    "alteradoPor" TEXT,

    CONSTRAINT "planos_acao_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "vendas_dia_data_idx" ON "vendas_dia"("data");

-- CreateIndex
CREATE INDEX "vendas_dia_sku_idx" ON "vendas_dia"("sku");

-- CreateIndex
CREATE UNIQUE INDEX "vendas_dia_sku_data_key" ON "vendas_dia"("sku", "data");

-- CreateIndex
CREATE INDEX "planos_acao_status_idx" ON "planos_acao"("status");

-- CreateIndex
CREATE INDEX "planos_acao_sku_idx" ON "planos_acao"("sku");

-- CreateIndex
CREATE INDEX "planos_acao_setorFab_idx" ON "planos_acao"("setorFab");

-- Seed default INMETRO defect limit (1000 ppm = 0.1%)
INSERT INTO "config" ("chave", "valor")
VALUES ('limiteDefeitoPpm', '1000')
ON CONFLICT ("chave") DO NOTHING;
