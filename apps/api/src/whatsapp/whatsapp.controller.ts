import { Body, Controller, Headers, Post, UnauthorizedException } from '@nestjs/common';
import { Public } from '../auth/auth.guard';
import { WhatsappService } from './whatsapp.service';
import { EvolutionService } from './evolution.service';

@Controller('whatsapp')
export class WhatsappController {
  constructor(
    private whatsapp: WhatsappService,
    private evolution: EvolutionService,
  ) {}

  @Public()
  @Post('webhook/evolution')
  async webhook(
    @Body() body: unknown,
    @Headers('x-evolution-secret') secret?: string,
    @Headers('apikey') apikey?: string,
  ) {
    const expected = process.env.EVOLUTION_WEBHOOK_SECRET;
    if (expected && secret !== expected && apikey !== process.env.EVOLUTION_API_KEY) {
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
  testSend(@Body() body: { telefone: string; texto: string }) {
    return this.evolution.sendText(body.telefone, body.texto || 'Teste SAC AISA');
  }
}
