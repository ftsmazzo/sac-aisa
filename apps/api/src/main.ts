import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { json, urlencoded } from 'express';
import { AppModule } from './app.module';
import { rateLimit } from './infra/rate-limit';
import { initSentry } from './infra/sentry';
import { SentryExceptionFilter } from './infra/sentry.filter';

config({ path: resolve(process.cwd(), '../../.env') });
config();

async function bootstrap() {
  await initSentry();
  const uploadDir = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');
  if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });

  // Import anual de vendas (~400KB+) estoura o default 100kb do body-parser
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
  });
  app.set('trust proxy', 1);
  app.useGlobalFilters(new SentryExceptionFilter());
  app.use(json({ limit: '20mb' }));
  app.use(urlencoded({ extended: true, limit: '20mb' }));
  app.enableCors({
    origin: (process.env.CORS_ORIGIN || 'http://localhost:3000').split(','),
    credentials: true,
  });
  app.useStaticAssets(uploadDir, { prefix: '/uploads/' });

  // Login e webhook: evita flood sem travar o restante da API
  app.use('/auth/login', rateLimit({ windowMs: 60_000, max: 20, prefix: 'login' }));
  app.use(
    '/whatsapp/webhook/evolution',
    rateLimit({ windowMs: 60_000, max: 300, prefix: 'wa' }),
  );

  const port = Number(process.env.API_PORT || 3001);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`SAC AISA API em http://localhost:${port}`);
}

bootstrap();
