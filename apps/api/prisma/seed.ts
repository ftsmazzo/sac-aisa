import { config } from 'dotenv';
import { resolve } from 'path';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';

config({ path: resolve(__dirname, '../../../.env') });
config();

const prisma = new PrismaClient();

async function main() {
  const count = await prisma.reclamacao.count();
  console.log(`Reclamações no banco: ${count} (dados iniciais vêm da migration seed_dados_iniciais)`);

  // Usuário admin com senha conhecida (bcrypt), além dos usuários importados do JSON
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
  console.log('Usuários do backup JSON mantêm a senha original (migram para bcrypt no 1º login).');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
