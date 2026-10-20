import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaService } from './prisma.service';
import { AuditoriaService } from './auditoria.service';
import { AuthController } from './auth/auth.controller';
import { AuthGuard } from './auth/auth.guard';
import { ReclamacoesService } from './reclamacoes/reclamacoes.service';
import { ReclamacoesController } from './reclamacoes/reclamacoes.controller';
import { GestaoController } from './gestao/gestao.controller';
import { AlertasService } from './alertas/alertas.service';
import { AlertasController } from './alertas/alertas.controller';
import { IaService } from './ia/ia.service';
import { IaController } from './ia/ia.controller';
import { EvolutionService } from './whatsapp/evolution.service';
import { WhatsappService } from './whatsapp/whatsapp.service';
import { WhatsappController } from './whatsapp/whatsapp.controller';
import { GestorAgentService } from './whatsapp/gestor-agent.service';
import { GestorToolsService } from './whatsapp/gestor-tools';
import { GestorMemoryService } from './whatsapp/gestor-memory.service';
import { DadosController } from './dados/dados.controller';
import { QualidadeController } from './qualidade/qualidade.controller';
import { QualidadeService } from './qualidade/qualidade.service';
import { PoliticaService } from './evolucao/politica.service';
import { EvolucaoService } from './evolucao/evolucao.service';
import { EvolucaoController } from './evolucao/evolucao.controller';
import { PermissoesService } from './permissoes/permissoes.service';
import { AdminController } from './admin/admin.controller';
import { BackupService } from './admin/backup.service';
import { RedisService } from './infra/redis.service';
import { FilaService } from './infra/fila.service';
import { ProdutoLookupService } from './produtos/produto-lookup.service';
import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/auth.guard';

@Controller()
class HealthController {
  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  @Public()
  @Get('health')
  async health() {
    let db: 'ok' | 'erro' = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      db = 'erro';
    }
    const redis = await this.redis.ping();
    const ok = db === 'ok';
    return {
      ok,
      sistema: 'AISA SAC',
      ts: new Date().toISOString(),
      checks: { db, redis },
    };
  }
}

@Module({
  imports: [
    ScheduleModule.forRoot(),
    JwtModule.register({
      global: true,
      secret: process.env.JWT_SECRET || 'dev-secret-change-me',
      signOptions: { expiresIn: '12h' },
    }),
  ],
  controllers: [
    HealthController,
    AuthController,
    ReclamacoesController,
    GestaoController,
    AlertasController,
    IaController,
    WhatsappController,
    DadosController,
    QualidadeController,
    EvolucaoController,
    AdminController,
  ],
  providers: [
    PrismaService,
    AuditoriaService,
    ReclamacoesService,
    AlertasService,
    IaService,
    EvolutionService,
    WhatsappService,
    GestorToolsService,
    GestorMemoryService,
    GestorAgentService,
    QualidadeService,
    PoliticaService,
    EvolucaoService,
    PermissoesService,
    BackupService,
    RedisService,
    FilaService,
    ProdutoLookupService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
