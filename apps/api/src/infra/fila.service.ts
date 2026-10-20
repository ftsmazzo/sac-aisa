import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { FilaStatus } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { RedisService } from './redis.service';

@Injectable()
export class FilaService {
  private readonly log = new Logger(FilaService.name);

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  async enfileirar(tipo: string, payload?: object) {
    const noRedis = await this.redis.enqueue(tipo, payload || {});
    const row = await this.prisma.filaTarefa.create({
      data: { tipo, payload: payload || {}, status: 'pendente' },
    });
    return { id: row.id, redis: noRedis };
  }

  @Cron(CronExpression.EVERY_MINUTE)
  async processarPendentes() {
    const jobs = await this.prisma.filaTarefa.findMany({
      where: { status: 'pendente' },
      orderBy: { criadoEm: 'asc' },
      take: 20,
    });
    for (const job of jobs) {
      await this.prisma.filaTarefa.update({
        where: { id: job.id },
        data: { status: 'processando', tentativas: { increment: 1 } },
      });
      try {
        await this.executar(job.tipo, job.payload);
        await this.prisma.filaTarefa.update({
          where: { id: job.id },
          data: { status: 'concluido' as FilaStatus, processadoEm: new Date(), ultimoErro: null },
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.log.warn(`Fila ${job.tipo} falhou: ${msg}`);
        await this.prisma.filaTarefa.update({
          where: { id: job.id },
          data: {
            status: job.tentativas >= 4 ? 'falhou' : 'pendente',
            ultimoErro: msg.slice(0, 500),
          },
        });
      }
    }
  }

  private async executar(tipo: string, _payload: unknown) {
    if (tipo === 'noop' || tipo === 'backup_solicitado') return;
    this.log.debug(`Tarefa ${tipo} registrada (handler padrão).`);
  }
}
