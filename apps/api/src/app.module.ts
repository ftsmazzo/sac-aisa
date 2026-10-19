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
import { DadosController } from './dados/dados.controller';
import { QualidadeController } from './qualidade/qualidade.controller';
import { QualidadeService } from './qualidade/qualidade.service';
import { PoliticaService } from './evolucao/politica.service';
import { EvolucaoService } from './evolucao/evolucao.service';
import { EvolucaoController } from './evolucao/evolucao.controller';
import { Controller, Get } from '@nestjs/common';
import { Public } from './auth/auth.guard';

@Controller()
class HealthController {
  @Public()
  @Get('health')
  health() {
    return { ok: true, sistema: 'AISA SAC', ts: new Date().toISOString() };
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
  ],
  providers: [
    PrismaService,
    AuditoriaService,
    ReclamacoesService,
    AlertasService,
    IaService,
    EvolutionService,
    WhatsappService,
    QualidadeService,
    PoliticaService,
    EvolucaoService,
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
