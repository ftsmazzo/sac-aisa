import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { AlertasService } from './alertas.service';
import { Roles } from '../auth/auth.guard';
import { AuthUser } from '../auth/auth.types';
import { AuditoriaService } from '../auditoria.service';

@Controller('alertas')
export class AlertasController {
  constructor(
    private service: AlertasService,
    private auditoria: AuditoriaService,
  ) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.service.list(status);
  }

  @Get('count')
  async count() {
    return { abertos: await this.service.countAbertos() };
  }

  @Roles('gestor', 'master')
  @Get('destinos')
  destinos() {
    return this.service.destinos();
  }

  @Roles('gestor', 'master')
  @Post('destinos')
  salvarDestino(
    @Body()
    body: {
      telefone: string;
      setor?: string;
      perfil?: string;
      nome?: string;
      id?: string;
      ativo?: boolean;
    },
  ) {
    return this.service.salvarDestino(body);
  }

  @Roles('gestor', 'master')
  @Post('varrer')
  varrer(@Req() req: { user: AuthUser }) {
    this.auditoria.registrar({
      user: req.user.login,
      nome: req.user.nome,
      perfil: req.user.perfil,
      acao: 'varreu alertas',
      alvo: 'Alertas',
    });
    return this.service.executarVarredura();
  }

  @Post(':id/resolver')
  resolver(@Param('id') id: string) {
    return this.service.resolver(id);
  }

  @Post(':id/ignorar')
  ignorar(@Param('id') id: string) {
    return this.service.ignorar(id);
  }
}
