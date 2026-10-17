import { Body, Controller, Post, Req, BadRequestException } from '@nestjs/common';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { Devolucao } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { Roles } from '../auth/auth.guard';
import { AuthUser } from '../auth/auth.types';
import { AuditoriaService } from '../auditoria.service';
import { situacao } from '../domain-bridge';

@Controller('dados')
export class DadosController {
  constructor(
    private prisma: PrismaService,
    private auditoria: AuditoriaService,
  ) {}

  @Roles('gestor', 'master')
  @Post('importar-backup')
  async importar(
    @Body() body: { path?: string; data?: unknown; limpar?: boolean },
    @Req() req: { user: AuthUser },
  ) {
    let raw = body.data;
    if (!raw && body.path) {
      if (!existsSync(body.path)) throw new BadRequestException('Arquivo não encontrado');
      raw = JSON.parse(readFileSync(body.path, 'utf8'));
    }
    if (!raw) {
      const candidates = [
        join(process.cwd(), 'data', 'sac_backup_ultimo.json'),
        join(process.cwd(), '..', '..', 'data', 'sac_backup_ultimo.json'),
        join(process.cwd(), '..', '..', '1792175715984_sac_backup_ultimo.json'),
      ];
      const found = candidates.find((p) => existsSync(p));
      if (!found) throw new BadRequestException('Envie data ou path do backup');
      raw = JSON.parse(readFileSync(found, 'utf8'));
    }

    const j = raw as {
      regs?: Record<string, unknown>[];
      usuarios?: Record<string, unknown>[];
      auditoria?: Record<string, unknown>[];
      depara?: Record<string, string>;
      regras?: Record<string, { setor?: string; acao?: string }>;
      base?: { cod: string; produto: string; setor?: string; status?: string; categoria?: string; familia?: string }[] | null;
    };
    const regs = Array.isArray(j) ? (j as unknown as Record<string, unknown>[]) : j.regs;
    if (!Array.isArray(regs)) throw new BadRequestException('Backup sem reclamações');

    if (body.limpar !== false) {
      await this.prisma.alerta.deleteMany();
      await this.prisma.reclamacaoFoto.deleteMany();
      await this.prisma.reclamacao.deleteMany();
    }

    let ok = 0;
    for (const x of regs) {
      const devolucao =
        x.devolucao === 'AGUARDANDO' || x.devolucao === 'RECEBIDO'
          ? (x.devolucao as Devolucao)
          : Devolucao.NA;
      const data = {
        id: String(x.id || undefined) || undefined,
        reg: Number(x.reg) || ok + 1,
        data: (x.data as string) || null,
        empresa: String(x.empresa || ''),
        setor: String(x.setor || ''),
        sku: String(x.sku || ''),
        produto: String(x.produto || ''),
        familia: String(x.familia || ''),
        garantia: String(x.garantia || ''),
        canal: String(x.canal || ''),
        protocolo: String(x.protocolo || ''),
        cliente: String(x.cliente || ''),
        cidade: String(x.cidade || ''),
        uf: String(x.uf || ''),
        reclamacao: String(x.reclamacao || ''),
        laudo: String(x.laudo || ''),
        procedencia: String(x.procedencia || ''),
        solucao: String(x.solucao || ''),
        dataAcao: (x.dataAcao as string) || null,
        obs: String(x.obs || ''),
        transp: String(x.transp || ''),
        freteEnvio: Number(x.freteEnvio || 0),
        freteRetorno: Number(x.freteRetorno || 0),
        valorPeca: Number(x.valorPeca || 0),
        estorno: Number(x.estorno || 0),
        desconto: Number(x.desconto || 0),
        guia: Number(x.guia || 0),
        devolucao,
        dataRecebimento: (x.dataRecebimento as string) || null,
        causaId: String(x.causaId || ''),
        causaManual: !!x.causaManual,
        obsCausa: String(x.obsCausa || ''),
        setorRespManual: String(x.setorRespManual || ''),
        peca: String(x.peca || ''),
        origem: 'import',
        rascunho: false,
        criadoPor: String(x.criadoPor || 'import'),
        alteradoPor: String(x.alteradoPor || 'import'),
      };
      const sit = situacao(data);
      await this.prisma.reclamacao.upsert({
        where: { reg: data.reg },
        create: { ...data, situacao: sit },
        update: { ...data, situacao: sit },
      });
      ok++;
    }

    if (j.usuarios?.length) {
      for (const u of j.usuarios) {
        const login = String(u.login || '').toLowerCase();
        if (!login) continue;
        await this.prisma.usuario.upsert({
          where: { login },
          create: {
            login,
            nome: String(u.nome || login),
            perfil: (u.perfil as 'master' | 'gestor' | 'operador') || 'operador',
            salt: String(u.salt || 'import'),
            hash: String(u.hash || 'x'),
            ativo: u.ativo !== false,
            criadoPor: String(u.criadoPor || 'import'),
          },
          update: {
            nome: String(u.nome || login),
            perfil: (u.perfil as 'master' | 'gestor' | 'operador') || 'operador',
            salt: String(u.salt || 'import'),
            hash: String(u.hash || 'x'),
            ativo: u.ativo !== false,
          },
        });
      }
    }

    if (j.depara && typeof j.depara === 'object') {
      for (const [skuOrigem, skuDestino] of Object.entries(j.depara)) {
        await this.prisma.skuDepara.upsert({
          where: { skuOrigem: skuOrigem.toUpperCase() },
          create: { skuOrigem: skuOrigem.toUpperCase(), skuDestino: String(skuDestino).toUpperCase() },
          update: { skuDestino: String(skuDestino).toUpperCase() },
        });
      }
    }

    if (j.regras && typeof j.regras === 'object') {
      for (const [causaId, r] of Object.entries(j.regras)) {
        await this.prisma.regraDirecionamento.upsert({
          where: { causaId },
          create: { causaId, setor: r.setor, acao: r.acao },
          update: { setor: r.setor, acao: r.acao },
        });
      }
    }

    if (Array.isArray(j.base)) {
      for (const p of j.base) {
        await this.prisma.produto.upsert({
          where: { cod: p.cod },
          create: {
            cod: p.cod,
            produto: p.produto,
            setor: p.setor || '',
            status: p.status === 'INATIVO' ? 'INATIVO' : 'ATIVO',
            categoria: p.categoria || '',
            familia: p.familia || '',
          },
          update: {
            produto: p.produto,
            setor: p.setor || '',
            status: p.status === 'INATIVO' ? 'INATIVO' : 'ATIVO',
            categoria: p.categoria || '',
            familia: p.familia || '',
          },
        });
      }
    }

    await this.auditoria.registrar({
      user: req.user.login,
      nome: req.user.nome,
      perfil: req.user.perfil,
      acao: 'importou backup',
      alvo: 'Dados',
      detalhe: `${ok} reclamações`,
    });

    return { ok: true, reclamacoes: ok };
  }

  @Roles('gestor', 'master')
  @Post('exportar-backup')
  async exportar() {
    const [regs, usuarios, auditoria, depara, regras, base] = await Promise.all([
      this.prisma.reclamacao.findMany({ include: { fotos: true } }),
      this.prisma.usuario.findMany(),
      this.prisma.auditoria.findMany({ orderBy: { ts: 'desc' }, take: 5000 }),
      this.prisma.skuDepara.findMany(),
      this.prisma.regraDirecionamento.findMany(),
      this.prisma.produto.findMany(),
    ]);
    return {
      versao: 3,
      sistema: 'AISA SAC',
      geradoEm: new Date().toISOString(),
      regs,
      usuarios: usuarios.map((u) => ({
        login: u.login,
        nome: u.nome,
        perfil: u.perfil,
        salt: u.salt,
        hash: u.hash,
        ativo: u.ativo,
        criadoEm: u.criadoEm,
        criadoPor: u.criadoPor,
      })),
      auditoria,
      depara: Object.fromEntries(depara.map((d) => [d.skuOrigem, d.skuDestino])),
      regras: Object.fromEntries(regras.map((r) => [r.causaId, { setor: r.setor, acao: r.acao }])),
      base,
    };
  }
}
