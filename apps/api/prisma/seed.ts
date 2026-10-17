import { config } from 'dotenv';
import { resolve, join } from 'path';
import { existsSync } from 'fs';
import { execSync } from 'child_process';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';

config({ path: resolve(__dirname, '../../../.env') });
config();

const prisma = new PrismaClient();

async function loadSeedSqlIfNeeded() {
  const count = await prisma.reclamacao.count();
  if (count > 0) {
    console.log(`Reclamações no banco: ${count} (seed SQL ignorado)`);
    return;
  }

  const sqlFile = join(__dirname, 'seed-dados.sql');
  if (!existsSync(sqlFile)) {
    console.warn('seed-dados.sql não encontrado; pulando carga inicial');
    return;
  }

  console.log('Banco vazio — aplicando seed-dados.sql...');
  execSync(`npx prisma db execute --file "${sqlFile}"`, {
    stdio: 'inherit',
    cwd: __dirname,
    env: process.env,
  });
  const after = await prisma.reclamacao.count();
  console.log(`Seed SQL OK. Reclamações: ${after}`);
}

async function main() {
  await loadSeedSqlIfNeeded();

  const demoSalt = randomBytes(8).toString('hex');
  const demoHash = await bcrypt.hash(`${demoSalt}:sac1234`, 10);
  await prisma.usuario.upsert({
    where: { login: 'admin' },
    create: {
      login: 'admin',
      nome: 'Administrador',
      perfil: 'master',
      salt: demoSalt,
      hash: demoHash,
      ativo: true,
      criadoPor: 'seed',
    },
    update: {
      salt: demoSalt,
      hash: demoHash,
      ativo: true,
      perfil: 'master',
    },
  });

  const defaults: Record<string, string> = {
    metaDias: process.env.ALERT_META_DIAS || '2',
    ALERT_AGUARDANDO_DIAS: process.env.ALERT_AGUARDANDO_DIAS || '7',
    ALERT_CUSTO_ALTO: process.env.ALERT_CUSTO_ALTO || '500',
    ALERT_OUTROS_DIAS: process.env.ALERT_OUTROS_DIAS || '3',
    ALERT_RASCUNHO_WHATSAPP_HORAS: process.env.ALERT_RASCUNHO_WHATSAPP_HORAS || '24',
  };
  for (const [chave, valor] of Object.entries(defaults)) {
    await prisma.config.upsert({
      where: { chave },
      create: { chave, valor },
      update: {},
    });
  }

  console.log('Seed OK. Login: admin / sac1234');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
