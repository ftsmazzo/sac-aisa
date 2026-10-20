import { Injectable, Logger } from '@nestjs/common';
import { RedisService } from '../infra/redis.service';

export type MemTurn = { role: 'user' | 'assistant'; content: string; ts: string };

export type GestorSlots = {
  ultimoSku?: string;
  ultimoPeriodo?: { de: string; ate: string; label?: string };
  ultimoSetor?: string;
  ultimoTema?: string;
  ultimaCausa?: string;
};

export type GestorMemory = {
  turns: MemTurn[];
  slots: GestorSlots;
};

const TTL_SEC = 60 * 60 * 24 * 7; // 7 dias
const MAX_TURNS = 20;

@Injectable()
export class GestorMemoryService {
  private readonly log = new Logger(GestorMemoryService.name);
  /** Fallback em memória do processo se Redis estiver off */
  private local = new Map<string, GestorMemory>();

  constructor(private redis: RedisService) {}

  private key(telefone: string) {
    const digits = telefone.replace(/\D/g, '') || telefone;
    return `sac:gestor:mem:${digits}`;
  }

  async load(telefone: string): Promise<GestorMemory> {
    const k = this.key(telefone);
    if (this.redis.ativo) {
      try {
        const raw = await this.redis.get(k);
        if (raw) {
          const parsed = JSON.parse(raw) as GestorMemory;
          return {
            turns: Array.isArray(parsed.turns) ? parsed.turns : [],
            slots: parsed.slots || {},
          };
        }
      } catch (e) {
        this.log.warn(`Redis load memória: ${e}`);
      }
    }
    return this.local.get(k) || { turns: [], slots: {} };
  }

  async save(telefone: string, mem: GestorMemory): Promise<void> {
    const k = this.key(telefone);
    const trimmed: GestorMemory = {
      turns: (mem.turns || []).slice(-MAX_TURNS),
      slots: mem.slots || {},
    };
    this.local.set(k, trimmed);
    if (this.redis.ativo) {
      try {
        await this.redis.set(k, JSON.stringify(trimmed), TTL_SEC);
      } catch (e) {
        this.log.warn(`Redis save memória: ${e}`);
      }
    }
  }

  async appendTurn(
    telefone: string,
    role: 'user' | 'assistant',
    content: string,
    slotPatch?: Partial<GestorSlots>,
  ): Promise<GestorMemory> {
    const mem = await this.load(telefone);
    mem.turns.push({
      role,
      content: content.slice(0, 2000),
      ts: new Date().toISOString(),
    });
    if (slotPatch) mem.slots = { ...mem.slots, ...slotPatch };
    mem.turns = mem.turns.slice(-MAX_TURNS);
    await this.save(telefone, mem);
    return mem;
  }

  historyForLlm(mem: GestorMemory): { role: 'user' | 'assistant'; content: string }[] {
    return (mem.turns || [])
      .filter((t) => t.content?.trim())
      .slice(-12)
      .map((t) => ({ role: t.role, content: t.content }));
  }

  slotsHint(slots: GestorSlots): string {
    const parts: string[] = [];
    if (slots.ultimoSku) parts.push(`SKU em foco: ${slots.ultimoSku}`);
    if (slots.ultimoPeriodo)
      parts.push(
        `Período em foco: ${slots.ultimoPeriodo.label || `${slots.ultimoPeriodo.de}→${slots.ultimoPeriodo.ate}`}`,
      );
    if (slots.ultimoSetor) parts.push(`Setor em foco: ${slots.ultimoSetor}`);
    if (slots.ultimaCausa) parts.push(`Causa em foco: ${slots.ultimaCausa}`);
    if (slots.ultimoTema) parts.push(`Tema: ${slots.ultimoTema}`);
    if (!parts.length) return '';
    return `Contexto persistente desta conversa:\n- ${parts.join('\n- ')}\nUse esses slots se o gestor for vago (“e esse?”, “ok”, “e no mês”).`;
  }
}
