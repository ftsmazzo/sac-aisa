-- Multi-motivo: causas adicionais por reclamação (causaId continua sendo a principal)
CREATE TABLE "reclamacao_causas" (
    "id" TEXT NOT NULL,
    "reclamacaoId" TEXT NOT NULL,
    "causaId" TEXT NOT NULL,
    "primaria" BOOLEAN NOT NULL DEFAULT false,
    "ordem" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "reclamacao_causas_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "reclamacao_causas_reclamacaoId_causaId_key" ON "reclamacao_causas"("reclamacaoId", "causaId");
CREATE INDEX "reclamacao_causas_causaId_idx" ON "reclamacao_causas"("causaId");

ALTER TABLE "reclamacao_causas" ADD CONSTRAINT "reclamacao_causas_reclamacaoId_fkey" FOREIGN KEY ("reclamacaoId") REFERENCES "reclamacoes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill a partir da causa principal existente
INSERT INTO "reclamacao_causas" ("id", "reclamacaoId", "causaId", "primaria", "ordem")
SELECT 'bc_' || r."id", r."id", r."causaId", true, 0
FROM "reclamacoes" r
WHERE r."causaId" IS NOT NULL AND r."causaId" <> '';
