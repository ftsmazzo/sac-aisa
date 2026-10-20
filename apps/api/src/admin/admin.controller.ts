import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { Response } from 'express';
import { Roles, Require } from '../auth/auth.guard';
import { AuthUser } from '../auth/auth.types';
import { AuditoriaService } from '../auditoria.service';
import { PermissoesService } from '../permissoes/permissoes.service';
import { BackupService } from './backup.service';
import { RedisService } from '../infra/redis.service';
import { PrismaService } from '../prisma.service';

@Controller('admin')
export class AdminController {
  constructor(
    private permissoes: PermissoesService,
    private backup: BackupService,
    private auditoria: AuditoriaService,
    private redis: RedisService,
    private prisma: PrismaService,
  ) {}

  @Roles('master')
  @Require('admin.ver')
  @Get('status')
  async status() {
    let db: 'ok' | 'erro' = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'erro';
    }
    return {
      db,
      redis: await this.redis.ping(),
      filaPendentes: await this.prisma.filaTarefa.count({ where: { status: 'pendente' } }),
    };
  }

  @Roles('master')
  @Require('admin.permissoes')
  @Get('permissoes/catalogo')
  catalogo() {
    return {
      catalogo: this.permissoes.catalogo(),
      padroes: {
        master: this.permissoes.padraoPerfil('master'),
        gestor: this.permissoes.padraoPerfil('gestor'),
        operador: this.permissoes.padraoPerfil('operador'),
      },
    };
  }

  @Roles('master')
  @Require('admin.permissoes')
  @Get('permissoes/:usuarioId')
  matriz(@Param('usuarioId') usuarioId: string) {
    return this.permissoes.matriz(usuarioId);
  }

  @Roles('master')
  @Require('admin.permissoes')
  @Post('permissoes/:usuarioId')
  async salvar(
    @Param('usuarioId') usuarioId: string,
    @Body() body: { itens?: { chave: string; permitido: boolean | null }[] },
    @Req() req: { user: AuthUser },
  ) {
    const r = await this.permissoes.salvarOverrides(usuarioId, body.itens || []);
    await this.auditoria.registrar({
      user: req.user.login,
      nome: req.user.nome,
      perfil: req.user.perfil,
      acao: 'alterou permissões',
      alvo: r.usuario.login,
      detalhe: `${(body.itens || []).length} toggles`,
    });
    return r;
  }

  @Roles('master')
  @Require('admin.permissoes')
  @Post('permissoes/:usuarioId/padrao')
  async padrao(@Param('usuarioId') usuarioId: string, @Req() req: { user: AuthUser }) {
    const r = await this.permissoes.aplicarPadrao(usuarioId);
    await this.auditoria.registrar({
      user: req.user.login,
      nome: req.user.nome,
      perfil: req.user.perfil,
      acao: 'restaurou permissões padrão',
      alvo: r.usuario.login,
    });
    return r;
  }

  @Roles('master')
  @Require('admin.backup')
  @Post('backup')
  async gerarBackup(@Req() req: { user: AuthUser }, @Res() res: Response) {
    const data = await this.backup.gerar();
    await this.auditoria.registrar({
      user: req.user.login,
      nome: req.user.nome,
      perfil: req.user.perfil,
      acao: 'gerou backup',
      alvo: 'Admin',
      detalhe: JSON.stringify(data.meta.contagens),
    });
    const nome = `sac-backup-${new Date().toISOString().slice(0, 10)}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    res.send(JSON.stringify(data, null, 2));
  }
}
