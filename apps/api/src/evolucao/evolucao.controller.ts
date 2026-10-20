import { Controller, Get, Post, Query, Req } from '@nestjs/common';
import { Roles, Require } from '../auth/auth.guard';
import { AuthUser } from '../auth/auth.types';
import { EvolucaoService } from './evolucao.service';

@Controller('evolucao')
export class EvolucaoController {
  constructor(private evolucao: EvolucaoService) {}

  @Get()
  estado() {
    return this.evolucao.estado();
  }

  @Roles('master')
  @Require('evolucao.ligar')
  @Post('ligar')
  ligar(@Req() req: { user: AuthUser }) {
    return this.evolucao.ligar(req.user);
  }

  @Roles('master')
  @Require('evolucao.ligar')
  @Post('voltar')
  voltar(@Req() req: { user: AuthUser }) {
    return this.evolucao.voltar(req.user);
  }

  @Get('decisoes')
  decisoes(@Query('resp') resp?: string) {
    return this.evolucao.decisoes(resp);
  }
}
