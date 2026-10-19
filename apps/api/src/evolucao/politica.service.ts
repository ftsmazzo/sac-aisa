import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { politicaDe, type PoliticaEvolucao } from '../domain-bridge';

@Injectable()
export class PoliticaService {
  constructor(private prisma: PrismaService) {}

  async get(): Promise<PoliticaEvolucao> {
    const rows = await this.prisma.config.findMany({
      where: {
        chave: {
          in: ['evolucao.ativa', 'ia.limiarDescartar', 'ia.limiarSobrepor', 'ia.guardarDivergencia'],
        },
      },
    });
    const map = Object.fromEntries(rows.map((r) => [r.chave, r.valor]));
    return politicaDe(map);
  }
}
