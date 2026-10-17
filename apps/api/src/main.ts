import 'reflect-metadata';
import { config } from 'dotenv';
import { resolve, join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

config({ path: resolve(process.cwd(), '../../.env') });
config();

async function bootstrap() {
  const uploadDir = process.env.UPLOAD_DIR || join(process.cwd(), 'uploads');
  if (!existsSync(uploadDir)) mkdirSync(uploadDir, { recursive: true });

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.enableCors({
    origin: (process.env.CORS_ORIGIN || 'http://localhost:3000').split(','),
    credentials: true,
  });
  app.useStaticAssets(uploadDir, { prefix: '/uploads/' });

  const port = Number(process.env.API_PORT || 3001);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`SAC AISA API em http://localhost:${port}`);
}

bootstrap();
