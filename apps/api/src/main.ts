import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { ENV, type Env } from './config/env';
import { loadDotEnv } from './config/load-dotenv';
import { configureApp } from './configure-app';

async function bootstrap(): Promise<void> {
  loadDotEnv();
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { bodyParser: false });
  const env = app.get<Env>(ENV);
  configureApp(app, env);
  await app.listen(env.PORT);
  console.warn(`GADMO API running on http://localhost:${env.PORT} (health: /health)`);
  if (env.NODE_ENV === 'development') {
    console.warn(`  Redis:    ${where(env.REDIS_URL)}`);
    console.warn(`  Database: ${where(env.DATABASE_URL)}`);
    console.warn(`  Login codes are printed below (SMS_PROVIDER=${env.SMS_PROVIDER}).`);
  }
}

/** host:port/path of a connection URL, without the username or password. */
function where(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}`;
  } catch {
    return '(unreadable URL)';
  }
}

void bootstrap();
