import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { FilaService } from '../infra/fila.service';

@Injectable()
export class BackupService {
  constructor(
    private prisma: PrismaService,
    private fila: FilaService,
  ) {}

  async gerar() {
    await this.fila.enfileirar('backup_solicitado', { origem: 'admin' });
    const [
      usuarios,
      produtos,
      causas,
      regras,
      reclamacoes,
      auditoria,
      config,
      alertas,
      destinos,
      vendas,
      planos,
      depara,
      permissoes,
    ] = await Promise.all([
      this.prisma.usuario.findMany({
        select: {
          id: true,
          login: true,
          nome: true,
          perfil: true,
          ativo: true,
          telefone: true,
          criadoEm: true,
        },
      }),
      this.prisma.produto.findMany(),
      this.prisma.causa.findMany(),
      this.prisma.regraDirecionamento.findMany(),
      this.prisma.reclamacao.findMany({
        include: { fotos: true, causas: { orderBy: { ordem: 'asc' } } },
      }),
      this.prisma.auditoria.findMany({ orderBy: { ts: 'desc' }, take: 5000 }),
      this.prisma.config.findMany(),
      this.prisma.alerta.findMany(),
      this.prisma.alertaDestino.findMany(),
      this.prisma.vendaDia.findMany(),
      this.prisma.planoAcao.findMany(),
      this.prisma.skuDepara.findMany(),
      this.prisma.permissaoUsuario.findMany(),
    ]);

    return {
      meta: {
        sistema: 'AISA SAC',
        geradoEm: new Date().toISOString(),
        tipo: 'backup-operacional',
        aviso:
          'Restaure preferencialmente num banco secundário (postgres-restore). Não aplique direto no principal sem teste.',
        contagens: {
          usuarios: usuarios.length,
          produtos: produtos.length,
          reclamacoes: reclamacoes.length,
          vendas: vendas.length,
          auditoria: auditoria.length,
        },
      },
      usuarios,
      produtos,
      causas,
      regras,
      reclamacoes,
      auditoria,
      config,
      alertas,
      destinos,
      vendas,
      planos,
      depara,
      permissoes,
    };
  }
}
