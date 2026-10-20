import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class EvolutionService {
  private readonly log = new Logger(EvolutionService.name);

  private get baseUrl() {
    return (process.env.EVOLUTION_API_URL || 'http://localhost:8080').replace(/\/$/, '');
  }

  private get apiKey() {
    return process.env.EVOLUTION_API_KEY || '';
  }

  private get instance() {
    return process.env.EVOLUTION_INSTANCE || 'sac-aisa';
  }

  private headers() {
    return {
      'Content-Type': 'application/json',
      apikey: this.apiKey,
    };
  }

  /**
   * Destino aceito pela Evolution:
   * - telefone E.164 (5511…)
   * - JID completo (5511…@s.whatsapp.net ou 123…@lid)
   */
  async sendText(numberOrJid: string, text: string) {
    if (!this.apiKey) {
      this.log.warn(`Evolution sem API key — mensagem simulada para ${numberOrJid}: ${text.slice(0, 80)}`);
      return { simulated: true };
    }
    const raw = String(numberOrJid || '').trim();
    const number = raw.includes('@') ? raw : raw.replace(/\D/g, '');
    if (!number) throw new Error('Destino vazio para sendText');

    const url = `${this.baseUrl}/message/sendText/${this.instance}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({ number, text }),
    });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Evolution sendText ${res.status}: ${body}`);
    }
    return res.json();
  }

  async setWebhook(webhookUrl: string) {
    if (!this.apiKey) return { skipped: true };
    const url = `${this.baseUrl}/webhook/set/${this.instance}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify({
        url: webhookUrl,
        webhook_by_events: false,
        webhook_base64: false,
        events: ['MESSAGES_UPSERT'],
      }),
    });
    if (!res.ok) throw new Error(`Evolution webhook ${res.status}`);
    return res.json();
  }
}
