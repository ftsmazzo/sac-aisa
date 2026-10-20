import { Request, Response, NextFunction } from 'express';

type Bucket = { n: number; reset: number };

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 5_000;

function clientIp(req: Request): string {
  // Com trust proxy no Express, req.ip já é o hop confiável
  if (req.ip) return req.ip;
  const xf = req.headers['x-forwarded-for'];
  if (typeof xf === 'string' && xf.trim()) return xf.split(',')[0].trim();
  return req.socket.remoteAddress || 'local';
}

/** Limite simples em memória por IP + rota. */
export function rateLimit(opts: { windowMs: number; max: number; prefix: string }) {
  return (req: Request, res: Response, next: NextFunction) => {
    const key = `${opts.prefix}:${clientIp(req)}`;
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || now > b.reset) {
      b = { n: 0, reset: now + opts.windowMs };
      if (buckets.size >= MAX_BUCKETS) {
        const first = buckets.keys().next().value;
        if (first) buckets.delete(first);
      }
      buckets.set(key, b);
    }
    b.n += 1;
    if (b.n > opts.max) {
      res.status(429).json({ message: 'Muitas tentativas. Aguarde um minuto.' });
      return;
    }
    next();
  };
}
