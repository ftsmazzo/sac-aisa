import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import { QualidadeService } from './qualidade.service';
import { Roles } from '../auth/auth.guard';
import { AuthUser } from '../auth/auth.types';

@Controller('qualidade')
export class QualidadeController {
  constructor(private service: QualidadeService) {}

  @Roles('gestor', 'master', 'operador')
  @Post('vendas/preview')
  preview(@Body() body: { texto?: string }) {
    const { linhas, erros } = this.service.parseVendasTexto(String(body.texto || ''));
    const datas = linhas.map((l) => l.data).sort();
    const skus = new Set(linhas.map((l) => l.sku));
    return {
      linhas: linhas.length,
      skus: skus.size,
      totalQtde: linhas.reduce((a, l) => a + l.qtde, 0),
      de: datas[0] || null,
      ate: datas[datas.length - 1] || null,
      avisos: erros.slice(0, 20),
      avisosTotal: erros.length,
      amostra: linhas.slice(0, 8),
    };
  }

  @Roles('gestor', 'master')
  @Post('vendas/importar')
  importar(@Body() body: { texto?: string }, @Req() req: { user: AuthUser }) {
    return this.service.importarVendas(String(body.texto || ''), req.user);
  }

  @Get('vendas/resumo')
  resumo(@Query() query: Record<string, string>) {
    return this.service.vendasResumo(query);
  }

  @Get('coeficientes')
  coeficientes(@Query() query: Record<string, string>) {
    return this.service.coeficientes(query);
  }

  @Get('painel')
  painel(@Query() query: Record<string, string>) {
    return this.service.painel(query);
  }

  @Get('exportar')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  async exportar(@Query() query: Record<string, string>, @Res() res: Response) {
    const coef = await this.service.coeficientes(query);
    const csv = this.service.exportCsv(coef);
    const nome = `qualidade_${query.de || 'inicio'}_${query.ate || 'hoje'}.csv`;
    res.setHeader('Content-Disposition', `attachment; filename="${nome}"`);
    res.send(csv);
  }

  @Get('planos')
  planos(@Query() query: Record<string, string>) {
    return this.service.listPlanos(query);
  }

  @Roles('gestor', 'master', 'operador')
  @Post('planos')
  criarPlano(@Body() body: Record<string, unknown>, @Req() req: { user: AuthUser }) {
    return this.service.criarPlano(body, req.user);
  }

  @Roles('gestor', 'master', 'operador')
  @Patch('planos/:id')
  atualizarPlano(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: { user: AuthUser },
  ) {
    return this.service.atualizarPlano(id, body, req.user);
  }
}
