import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma.service';
import { AuditoriaService } from '../auditoria.service';
import { Public } from './auth.guard';
import { AuthUser } from './auth.types';

function hashLegado(salt: string, senha: string) {
  return createHash('sha256').update(`${salt}:${senha}`).digest('hex');
}

@Controller('auth')
export class AuthController {
  constructor(
    private prisma: PrismaService,
    private jwt: JwtService,
    private auditoria: AuditoriaService,
  ) {}

  @Public()
  @Post('login')
  async login(@Body() body: { login?: string; senha?: string }) {
    const login = String(body.login || '')
      .trim()
      .toLowerCase();
    const senha = String(body.senha || '');
    const u = await this.prisma.usuario.findUnique({ where: { login } });
    if (!u || !u.ativo) {
      await this.auditoria.registrar({
        user: login || 'desconhecido',
        acao: 'login negado',
        alvo: 'Sistema',
        detalhe: `Tentativa com usuário "${login}"`,
      });
      throw new UnauthorizedException('Usuário ou senha inválidos');
    }

    let ok = false;
    if (u.hash.length === 64 && /^[0-9a-f]+$/i.test(u.hash)) {
      ok = hashLegado(u.salt, senha) === u.hash;
      if (ok) {
        const salt = randomBytes(8).toString('hex');
        const hash = await bcrypt.hash(`${salt}:${senha}`, 10);
        await this.prisma.usuario.update({ where: { id: u.id }, data: { salt, hash } });
      }
    } else {
      ok = await bcrypt.compare(`${u.salt}:${senha}`, u.hash);
    }

    if (!ok) {
      await this.auditoria.registrar({
        user: login,
        acao: 'login negado',
        alvo: 'Sistema',
      });
      throw new UnauthorizedException('Usuário ou senha inválidos');
    }

    const payload = { sub: u.id, login: u.login, nome: u.nome, perfil: u.perfil };
    const token = await this.jwt.signAsync(payload);
    await this.auditoria.registrar({
      user: u.login,
      nome: u.nome,
      perfil: u.perfil,
      acao: 'login',
      alvo: 'Sistema',
    });
    return { token, user: payload };
  }

  @Get('me')
  me(@Req() req: { user: AuthUser }) {
    return { user: req.user };
  }

  @Post('senha')
  async alterarSenha(
    @Req() req: { user: AuthUser },
    @Body() body: { atual?: string; nova?: string },
  ) {
    const nova = String(body.nova || '');
    if (nova.length < 4) throw new BadRequestException('Senha mínima: 4 caracteres');
    const u = await this.prisma.usuario.findUniqueOrThrow({ where: { id: req.user.sub } });
    let ok = false;
    if (u.hash.length === 64 && /^[0-9a-f]+$/i.test(u.hash)) {
      ok = hashLegado(u.salt, String(body.atual || '')) === u.hash;
    } else {
      ok = await bcrypt.compare(`${u.salt}:${String(body.atual || '')}`, u.hash);
    }
    if (!ok) throw new UnauthorizedException('Senha atual incorreta');
    const salt = randomBytes(8).toString('hex');
    const hash = await bcrypt.hash(`${salt}:${nova}`, 10);
    await this.prisma.usuario.update({ where: { id: u.id }, data: { salt, hash } });
    await this.auditoria.registrar({
      user: u.login,
      nome: u.nome,
      perfil: u.perfil,
      acao: 'alterou senha',
      alvo: 'Usuário',
    });
    return { ok: true };
  }
}
