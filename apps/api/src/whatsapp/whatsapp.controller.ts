import { Body, Controller, ForbiddenException, Headers, Post, Req, UnauthorizedException } from '@nestjs/common';
import { Public } from '../auth/auth.guard';
import { AuthUser } from '../auth/auth.types';
import { WhatsappService } from './whatsapp.service';
import { EvolutionService } from './evolution.service';
import { PoliticaService } from '../evolucao/politica.service';

@Controller('whatsapp')
export class WhatsappController {
  constructor(
    private whatsapp: WhatsappService,
    private evolution: EvolutionService,
    private politica: PoliticaService,
  ) {}

  @Public()
  @Post('webhook/evolution')
  async webhook(
    @Body() body: unknown,
    @Headers('x-evolution-secret') secret?: string,
    @Headers('apikey') apikey?: string,
  ) {
    const expected = (process.env.EVOLUTION_WEBHOOK_SECRET || '').trim();
    // Sem secret na API = aceita (Evolution Manager muitas vezes não manda header).
    // Com secret: aceita header x-evolution-secret OU apikey da Evolution.
    if (expected) {
      const autorizado = secret === expected || apikey === process.env.EVOLUTION_API_KEY;
      if (!autorizado) {
        throw new UnauthorizedException(
          'Webhook não autorizado — confira EVOLUTION_WEBHOOK_SECRET ou deixe a variável vazia',
        );
      }
    }
    return this.whatsapp.handleWebhook(body);
  }

  @Post('evolution/configure-webhook')
  configure() {
    const publicUrl = process.env.PUBLIC_API_URL || 'http://localhost:3001';
    return this.evolution.setWebhook(`${publicUrl}/whatsapp/webhook/evolution`);
  }

  @Post('test-send')
  async testSend(@Body() body: { telefone: string; texto: string }, @Req() req: { user: AuthUser }) {
    const pol = await this.politica.get();
    if (pol.ativa && req.user.perfil !== 'master') {
      throw new ForbiddenException('Com a evolução ligada, o envio de teste fica só com o perfil master.');
    }
    return this.evolution.sendText(body.telefone, body.texto || 'Teste SAC AISA');
  }
}
