import { Injectable } from '@nestjs/common';
import { PrismaService } from './prisma.service';

@Injectable()
export class AuditoriaService {
  constructor(private prisma: PrismaService) {}

  async registrar(params: {
    user: string;
    nome?: string;
    perfil?: string;
    acao: string;
    alvo?: string;
    detalhe?: string;
    recId?: string;
    extra?: unknown;
  }) {
    return this.prisma.auditoria.create({
      data: {
        user: params.user,
        nome: params.nome || '',
        perfil: params.perfil || '',
        acao: params.acao,
        alvo: params.alvo || '',
        detalhe: params.detalhe || '',
        recId: params.recId,
        extra: params.extra as object | undefined,
      },
    });
  }
}
