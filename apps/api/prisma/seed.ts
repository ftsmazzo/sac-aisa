import { config } from 'dotenv';
import { resolve, join } from 'path';
import { readFileSync, existsSync } from 'fs';
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { CAUSAS, parseSeedProdutos, situacao } from '@sac-aisa/domain';

config({ path: resolve(__dirname, '../../../.env') });
config();

const prisma = new PrismaClient();

async function main() {
  const salt = randomBytes(8).toString('hex');
  const hash = await bcrypt.hash(`${salt}:admin123`, 10);

  await prisma.usuario.upsert({
    where: { login: 'renato' },
    create: {
      login: 'renato',
      nome: 'Renato',
      perfil: 'master',
      salt,
      hash,
      ativo: true,
      criadoPor: 'seed',
    },
    update: {},
  });

  // ensure a known bcrypt user for first login if legado fails
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
    update: { salt: demoSalt, hash: demoHash, ativo: true },
  });

  for (const [i, c] of CAUSAS.entries()) {
    const { t: _t, ...rest } = c;
    await prisma.causa.upsert({
      where: { id: rest.id },
      create: { ...rest, ordem: i },
      update: { ...rest, ordem: i },
    });
  }

  const seedPath = join(__dirname, '../../../packages/domain/src/seed-produtos.txt');
  if (existsSync(seedPath)) {
    const produtos = parseSeedProdutos(readFileSync(seedPath, 'utf8'));
    for (const p of produtos) {
      await prisma.produto.upsert({
        where: { cod: p.cod },
        create: {
          cod: p.cod,
          produto: p.produto,
          setor: p.setor,
          status: p.status === 'INATIVO' ? 'INATIVO' : 'ATIVO',
          categoria: p.categoria,
          familia: p.familia,
        },
        update: {
          produto: p.produto,
          setor: p.setor,
          status: p.status === 'INATIVO' ? 'INATIVO' : 'ATIVO',
          categoria: p.categoria,
          familia: p.familia,
        },
      });
    }
    console.log(`Produtos: ${produtos.length}`);
  }

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

  const backupCandidates = [
    join(__dirname, '../../../data/sac_backup_ultimo.json'),
    join(__dirname, '../../../1792175715984_sac_backup_ultimo.json'),
  ];
  const backup = backupCandidates.find((p) => existsSync(p));
  if (backup) {
    const j = JSON.parse(readFileSync(backup, 'utf8'));
    const regs = j.regs || [];
    let n = 0;
    for (const x of regs) {
      const devolucao =
        x.devolucao === 'AGUARDANDO' || x.devolucao === 'RECEBIDO' ? x.devolucao : 'NA';
      const data = {
        reg: Number(x.reg),
        data: x.data || null,
        empresa: x.empresa || '',
        setor: x.setor || '',
        sku: x.sku || '',
        produto: x.produto || '',
        familia: x.familia || '',
        garantia: x.garantia || '',
        canal: x.canal || '',
        protocolo: x.protocolo || '',
        cliente: x.cliente || '',
        cidade: x.cidade || '',
        uf: x.uf || '',
        reclamacao: x.reclamacao || '',
        laudo: x.laudo || '',
        procedencia: x.procedencia || '',
        solucao: x.solucao || '',
        dataAcao: x.dataAcao || null,
        obs: x.obs || '',
        transp: x.transp || '',
        freteEnvio: Number(x.freteEnvio || 0),
        freteRetorno: Number(x.freteRetorno || 0),
        valorPeca: Number(x.valorPeca || 0),
        estorno: Number(x.estorno || 0),
        desconto: Number(x.desconto || 0),
        guia: Number(x.guia || 0),
        devolucao,
        dataRecebimento: x.dataRecebimento || null,
        causaId: x.causaId || '',
        causaManual: !!x.causaManual,
        obsCausa: x.obsCausa || '',
        setorRespManual: x.setorRespManual || '',
        peca: x.peca || '',
        origem: 'import',
        rascunho: false,
        criadoPor: x.criadoPor || 'seed',
        alteradoPor: x.alteradoPor || 'seed',
      };
      await prisma.reclamacao.upsert({
        where: { reg: data.reg },
        create: { id: x.id, ...data, situacao: situacao(data) },
        update: { ...data, situacao: situacao(data) },
      });
      n++;
    }
    if (Array.isArray(j.usuarios)) {
      for (const u of j.usuarios) {
        await prisma.usuario.upsert({
          where: { login: String(u.login).toLowerCase() },
          create: {
            login: String(u.login).toLowerCase(),
            nome: u.nome,
            perfil: u.perfil,
            salt: u.salt,
            hash: u.hash,
            ativo: u.ativo !== false,
            criadoPor: u.criadoPor || 'seed',
          },
          update: {
            nome: u.nome,
            perfil: u.perfil,
            salt: u.salt,
            hash: u.hash,
            ativo: u.ativo !== false,
          },
        });
      }
    }
    console.log(`Reclamações importadas: ${n}`);
  }

  console.log('Seed OK. Logins: admin / sac1234 (e usuários do backup com senha original).');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
