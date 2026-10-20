import { Logger } from '@nestjs/common';

const log = new Logger('Glitchtip');

/** Liga o Glitchtip (DSN compatível com Sentry) se SENTRY_DSN estiver no env. */
export async function initSentry() {
  const dsn = process.env.SENTRY_DSN?.trim();
  if (!dsn) return;
  try {
    // Import dinâmico: se o pacote não estiver instalado, a API sobe sem erro.
    const Sentry = await import('@sentry/node');
    Sentry.init({
      dsn,
      environment: process.env.NODE_ENV || 'production',
      tracesSampleRate: 0.05,
    });
    log.log('Glitchtip/Sentry ativo');
  } catch (e) {
    log.warn(`SENTRY_DSN definido, mas @sentry/node não carregou: ${e}`);
  }
}

export async function captureException(err: unknown) {
  try {
    const Sentry = await import('@sentry/node');
    Sentry.captureException(err);
  } catch {
    /* ignore */
  }
}
