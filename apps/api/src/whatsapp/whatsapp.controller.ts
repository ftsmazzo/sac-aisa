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
    const expected = process.env.EVOLUTION_WEBHOOK_SECRET;
    const pol = await this.politica.get();
    const autorizado = !!expected && (secret === expected || apikey === process.env.EVOLUTION_API_KEY);
    const recusar = pol.ativa ? !autorizado : Boolean(expected) && !autorizado;
    if (recusar) {
      throw new UnauthorizedException('Webhook não autorizado');
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
