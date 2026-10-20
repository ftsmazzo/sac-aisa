import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
  ForbiddenException,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { Perfil } from '@prisma/client';
import { JwtPayload } from './auth.types';
import { PermissoesService } from '../permissoes/permissoes.service';

export const ROLES_KEY = 'roles';
export const PERMS_KEY = 'perms';
export const Roles = (...roles: Perfil[]) => SetMetadata(ROLES_KEY, roles);
export const Require = (...perms: string[]) => SetMetadata(PERMS_KEY, perms);
export const Public = () => SetMetadata('isPublic', true);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private jwt: JwtService,
    private reflector: Reflector,
    private permissoes: PermissoesService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>('isPublic', [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (isPublic) return true;

    const req = ctx.switchToHttp().getRequest();
    const header = req.headers.authorization as string | undefined;
    if (!header?.startsWith('Bearer ')) throw new UnauthorizedException('Token ausente');
    try {
      const payload = this.jwt.verify<JwtPayload>(header.slice(7));
      req.user = payload;
    } catch {
      throw new UnauthorizedException('Token inválido');
    }

    if (req.user.perfil === 'master') return true;

    const roles = this.reflector.getAllAndOverride<Perfil[]>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (roles?.length && !roles.includes(req.user.perfil)) {
      throw new ForbiddenException('Sem permissão');
    }

    const perms = this.reflector.getAllAndOverride<string[]>(PERMS_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    if (perms?.length) {
      const lista = await this.permissoes.listaDoUsuario(req.user.sub, req.user.perfil);
      if (!perms.every((p) => lista.includes(p))) {
        throw new ForbiddenException('Sem permissão para esta ação');
      }
    }
    return true;
  }
}
