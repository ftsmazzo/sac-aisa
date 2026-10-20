import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly log = new Logger(RedisService.name);
  private client: Redis | null = null;

  constructor() {
    const url = process.env.REDIS_URL?.trim();
    if (!url) {
      this.log.warn('REDIS_URL ausente — fila usa só Postgres.');
      return;
    }
    try {
      this.client = new Redis(url, {
        maxRetriesPerRequest: 1,
        enableReadyCheck: true,
        retryStrategy: () => null,
      });
      this.client.on('error', (e) => this.log.warn(`Redis: ${e.message}`));
    } catch (e) {
      this.log.warn(`Redis não iniciou: ${e}`);
      this.client = null;
    }
  }

  get ativo() {
    return !!this.client;
  }

  async ping(): Promise<'ok' | 'off' | 'erro'> {
    if (!this.client) return 'off';
    try {
      const r = await this.client.ping();
      return r === 'PONG' ? 'ok' : 'erro';
    } catch {
      return 'erro';
    }
  }

  async enqueue(tipo: string, payload: unknown) {
    if (!this.client) return false;
    try {
      await this.client.lpush(
        'sac:fila',
        JSON.stringify({ tipo, payload, ts: new Date().toISOString() }),
      );
      return true;
    } catch {
      return false;
    }
  }

  async get(key: string): Promise<string | null> {
    if (!this.client) return null;
    try {
      return await this.client.get(key);
    } catch {
      return null;
    }
  }

  async set(key: string, value: string, ttlSec?: number): Promise<boolean> {
    if (!this.client) return false;
    try {
      if (ttlSec && ttlSec > 0) {
        await this.client.set(key, value, 'EX', ttlSec);
      } else {
        await this.client.set(key, value);
      }
      return true;
    } catch {
      return false;
    }
  }

  async onModuleDestroy() {
    if (this.client) await this.client.quit().catch(() => undefined);
  }
}
