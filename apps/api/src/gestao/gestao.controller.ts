import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  BadRequestException,
} from '@nestjs/common';
import { Perfil, ProdutoStatus } from '@prisma/client';
import { randomBytes } from 'crypto';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma.service';
import { Roles } from '../auth/auth.guard';
import { AuthUser } from '../auth/auth.types';
import { AuditoriaService } from '../auditoria.service';
import { CAUSAS, SETORES_RESP } from '../domain-bridge';
import { ProdutoLookupService } from '../produtos/produto-lookup.service';

@Controller('gestao')
export class GestaoController {
  constructor(
    private prisma: PrismaService,
    private audit: AuditoriaService,
    private produtoLookup: ProdutoLookupService,
  ) {}

  @Get('causas')
  causas() {
    return CAUSAS.map(({ t: _t, ...c }) => c);
  }

  @Get('setores-resp')
  setores() {
    return SETORES_RESP;
  }

  @Roles('gestor', 'master')
  @Get('usuarios')
  usuarios() {
    return this.prisma.usuario.findMany({
      select: {
        id: true,
        login: true,
        nome: true,
        perfil: true,
        ativo: true,
        telefone: true,
        criadoEm: true,
        criadoPor: true,
      },
      orderBy: { login: 'asc' },
    });
  }

  @Roles('gestor', 'master')
  @Post('usuarios')
  async criarUsuario(@Body() body: Record<string, unknown>, @Req() req: { user: AuthUser }) {
    const login = String(body.login || '')
      .trim()
      .toLowerCase();
    const nome = String(body.nome || '').trim();
    const senha = String(body.senha || '');
    const perfil = (body.perfil as Perfil) || 'operador';
    if (!login || !nome || senha.length < 4) throw new BadRequestException('Dados inválidos');
    if (perfil === 'master' && req.user.perfil !== 'master') {
      throw new BadRequestException('Só master cria master');
    }
    const salt = randomBytes(8).toString('hex');
    const hash = await bcrypt.hash(`${salt}:${senha}`, 10);
    const u = await this.prisma.usuario.create({
      data: {
        login,
        nome,
        perfil,
        salt,
        hash,
        ativo: body.ativo !== false,
        telefone: String(body.telefone || '') || null,
        criadoPor: req.user.login,
      },
    });
    await this.audit.registrar({
      user: req.user.login,
      nome: req.user.nome,
      perfil: req.user.perfil,
      acao: 'criou usuário',
      alvo: login,
    });
    return { id: u.id, login: u.login, nome: u.nome, perfil: u.perfil, ativo: u.ativo };
  }

  @Roles('gestor', 'master')
  @Patch('usuarios/:id')
  async patchUsuario(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: { user: AuthUser },
  ) {
    const data: Record<string, unknown> = {};
    if (body.nome !== undefined) data.nome = String(body.nome);
    if (body.ativo !== undefined) data.ativo = !!body.ativo;
    if (body.telefone !== undefined) data.telefone = String(body.telefone || '') || null;
    if (body.perfil !== undefined) {
      if (body.perfil === 'master' && req.user.perfil !== 'master') {
        throw new BadRequestException('Só master define master');
      }
      data.perfil = body.perfil;
    }
    if (body.senha) {
      const salt = randomBytes(8).toString('hex');
      data.salt = salt;
      data.hash = await bcrypt.hash(`${salt}:${String(body.senha)}`, 10);
    }
    const u = await this.prisma.usuario.update({ where: { id }, data });
    return { id: u.id, login: u.login, nome: u.nome, perfil: u.perfil, ativo: u.ativo };
  }

  @Get('produtos')
  produtos(@Query('q') q?: string) {
    return this.prisma.produto.findMany({
      where: q
        ? {
            OR: [
              { cod: { contains: q, mode: 'insensitive' } },
              { produto: { contains: q, mode: 'insensitive' } },
              { familia: { contains: q, mode: 'insensitive' } },
            ],
          }
        : undefined,
      orderBy: { cod: 'asc' },
      take: 500,
    });
  }

  /** Resolve SKU → produto/setor fab./família (como o HTML antigo ao digitar o SKU). */
  @Get('produtos/por-sku')
  porSku(@Query('sku') sku?: string) {
    return this.produtoLookup.lookup(String(sku || ''));
  }

  @Roles('master')
  @Post('produtos')
  criarProduto(@Body() body: Record<string, unknown>) {
    return this.prisma.produto.create({
      data: {
        cod: String(body.cod || '').toUpperCase(),
        produto: String(body.produto || ''),
        setor: String(body.setor || ''),
        status: (body.status as ProdutoStatus) || 'ATIVO',
        categoria: String(body.categoria || ''),
        familia: String(body.familia || ''),
      },
    });
  }

  @Roles('master')
  @Patch('produtos/:id')
  patchProduto(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.prisma.produto.update({
      where: { id },
      data: {
        produto: body.produto !== undefined ? String(body.produto) : undefined,
        setor: body.setor !== undefined ? String(body.setor) : undefined,
        status: body.status as ProdutoStatus | undefined,
        categoria: body.categoria !== undefined ? String(body.categoria) : undefined,
        familia: body.familia !== undefined ? String(body.familia) : undefined,
      },
    });
  }

  @Roles('gestor', 'master')
  @Get('regras')
  async regras() {
    const overrides = await this.prisma.regraDirecionamento.findMany();
    const map = Object.fromEntries(overrides.map((o) => [o.causaId, o]));
    return CAUSAS.map(({ t: _t, ...c }) => ({
      ...c,
      setor: map[c.id]?.setor || c.setor,
      acao: map[c.id]?.acao || c.acao,
      customizado: !!map[c.id],
    }));
  }

  @Roles('gestor', 'master')
  @Post('regras')
  async salvarRegras(
    @Body() body: { regras?: { causaId: string; setor?: string; acao?: string }[] },
    @Req() req: { user: AuthUser },
  ) {
    for (const r of body.regras || []) {
      await this.prisma.regraDirecionamento.upsert({
        where: { causaId: r.causaId },
        create: { causaId: r.causaId, setor: r.setor, acao: r.acao },
        update: { setor: r.setor, acao: r.acao },
      });
    }
    await this.audit.registrar({
      user: req.user.login,
      nome: req.user.nome,
      perfil: req.user.perfil,
      acao: 'alterou regras de direcionamento',
      alvo: 'Regras',
    });
    return this.regras();
  }

  @Roles('gestor', 'master')
  @Get('depara')
  depara() {
    return this.prisma.skuDepara.findMany({ orderBy: { skuOrigem: 'asc' } });
  }

  @Roles('gestor', 'master')
  @Post('depara')
  async salvarDepara(
    @Body() body: { itens?: { skuOrigem: string; skuDestino: string }[] },
    @Req() req: { user: AuthUser },
  ) {
    await this.prisma.skuDepara.deleteMany();
    if (body.itens?.length) {
      await this.prisma.skuDepara.createMany({
        data: body.itens.map((i) => ({
          skuOrigem: i.skuOrigem.toUpperCase(),
          skuDestino: i.skuDestino.toUpperCase(),
        })),
      });
    }
    await this.audit.registrar({
      user: req.user.login,
      nome: req.user.nome,
      perfil: req.user.perfil,
      acao: 'alterou o de-para de SKUs',
      alvo: 'De-para',
    });
    return this.depara();
  }

  @Roles('gestor', 'master')
  @Get('auditoria')
  listAuditoria(@Query('q') q?: string, @Query('limit') limit?: string) {
    return this.prisma.auditoria.findMany({
      where: q
        ? {
            OR: [
              { acao: { contains: q, mode: 'insensitive' } },
              { user: { contains: q, mode: 'insensitive' } },
              { alvo: { contains: q, mode: 'insensitive' } },
            ],
          }
        : undefined,
      orderBy: { ts: 'desc' },
      take: Math.min(Number(limit) || 200, 1000),
    });
  }

  @Get('config')
  async config() {
    const rows = await this.prisma.config.findMany();
    return Object.fromEntries(rows.map((r) => [r.chave, r.valor]));
  }

  @Roles('gestor', 'master')
  @Post('config')
  async setConfig(@Body() body: Record<string, string>, @Req() req: { user: AuthUser }) {
    for (const [chave, valor] of Object.entries(body)) {
      await this.prisma.config.upsert({
        where: { chave },
        create: { chave, valor: String(valor) },
        update: { valor: String(valor) },
      });
    }
    await this.audit.registrar({
      user: req.user.login,
      nome: req.user.nome,
      perfil: req.user.perfil,
      acao: 'alterou config',
      alvo: 'Config',
      detalhe: Object.keys(body).join(', '),
    });
    return this.config();
  }

  @Roles('gestor', 'master')
  @Delete('depara/:id')
  deleteDepara(@Param('id') id: string) {
    return this.prisma.skuDepara.delete({ where: { id } });
  }
}
