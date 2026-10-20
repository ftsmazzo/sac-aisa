-- CreateEnum
CREATE TYPE "FilaStatus" AS ENUM ('pendente', 'processando', 'concluido', 'falhou');

-- CreateTable
CREATE TABLE "permissoes_usuario" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "chave" TEXT NOT NULL,
    "permitido" BOOLEAN NOT NULL,

    CONSTRAINT "permissoes_usuario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fila_tarefas" (
    "id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "payload" JSONB,
    "status" "FilaStatus" NOT NULL DEFAULT 'pendente',
    "tentativas" INTEGER NOT NULL DEFAULT 0,
    "ultimoErro" TEXT,
    "criadoEm" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processadoEm" TIMESTAMP(3),

    CONSTRAINT "fila_tarefas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "permissoes_usuario_usuarioId_idx" ON "permissoes_usuario"("usuarioId");

-- CreateIndex
CREATE UNIQUE INDEX "permissoes_usuario_usuarioId_chave_key" ON "permissoes_usuario"("usuarioId", "chave");

-- CreateIndex
CREATE INDEX "fila_tarefas_status_tipo_idx" ON "fila_tarefas"("status", "tipo");

-- AddForeignKey
ALTER TABLE "permissoes_usuario" ADD CONSTRAINT "permissoes_usuario_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "usuarios"("id") ON DELETE CASCADE ON UPDATE CASCADE;
