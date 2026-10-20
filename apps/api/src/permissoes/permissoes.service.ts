import { Injectable } from '@nestjs/common';
import { Perfil } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import {
  PERMISSOES_CATALOGO,
  PERMISSOES_PADRAO,
  mesclarPermissoes,
} from '../domain-bridge';

@Injectable()
export class PermissoesService {
  constructor(private prisma: PrismaService) {}

  catalogo() {
    return PERMISSOES_CATALOGO.map((p) => ({ ...p }));
  }

  padraoPerfil(perfil: Perfil) {
    return [...(PERMISSOES_PADRAO[perfil] || PERMISSOES_PADRAO.operador)];
  }

  async listaDoUsuario(usuarioId: string, perfil: Perfil): Promise<string[]> {
    if (perfil === 'master') return this.padraoPerfil('master');
    const rows = await this.prisma.permissaoUsuario.findMany({ where: { usuarioId } });
    return mesclarPermissoes(
      perfil,
      rows.map((r) => ({ chave: r.chave, permitido: r.permitido })),
    );
  }

  async matriz(usuarioId: string) {
    const u = await this.prisma.usuario.findUniqueOrThrow({
      where: { id: usuarioId },
      select: { id: true, login: true, nome: true, perfil: true, ativo: true },
    });
    const overrides = await this.prisma.permissaoUsuario.findMany({ where: { usuarioId } });
    const efetiva = await this.listaDoUsuario(u.id, u.perfil);
    const padrao = this.padraoPerfil(u.perfil);
    return {
      usuario: u,
      catalogo: this.catalogo(),
      padrao,
      overrides: Object.fromEntries(overrides.map((o) => [o.chave, o.permitido])),
      efetiva,
    };
  }

  async salvarOverrides(
    usuarioId: string,
    itens: { chave: string; permitido: boolean | null }[],
  ) {
    const u = await this.prisma.usuario.findUniqueOrThrow({ where: { id: usuarioId } });
    if (u.perfil === 'master') {
      await this.prisma.permissaoUsuario.deleteMany({ where: { usuarioId } });
      return this.matriz(usuarioId);
    }
    const validas = new Set(PERMISSOES_CATALOGO.map((c) => c.chave));
    for (const item of itens) {
      if (!validas.has(item.chave as never)) continue;
      if (item.permitido === null) {
        await this.prisma.permissaoUsuario.deleteMany({
          where: { usuarioId, chave: item.chave },
        });
        continue;
      }
      await this.prisma.permissaoUsuario.upsert({
        where: { usuarioId_chave: { usuarioId, chave: item.chave } },
        create: { usuarioId, chave: item.chave, permitido: item.permitido },
        update: { permitido: item.permitido },
      });
    }
    return this.matriz(usuarioId);
  }

  async aplicarPadrao(usuarioId: string) {
    await this.prisma.permissaoUsuario.deleteMany({ where: { usuarioId } });
    return this.matriz(usuarioId);
  }
}
