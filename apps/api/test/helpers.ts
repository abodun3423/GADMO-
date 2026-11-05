import 'reflect-metadata';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import type Redis from 'ioredis';
import request from 'supertest';
import type TestAgent from 'supertest/lib/agent';
import { AppModule } from '../src/app.module';
import { SMS_SENDER, type SmsSender } from '../src/auth/sms';
import { ENV, type Env } from '../src/config/env';
import { configureApp } from '../src/configure-app';
import { DB, REDIS, type Db } from '../src/infra/infra.module';
import { TEST_ENV } from './test-env';

/** Captures the last code "sent" to each phone instead of sending an SMS. */
export class CapturingSms implements SmsSender {
  readonly lastCode = new Map<string, string>();
  readonly sent: { to: string; text: string }[] = [];
  async send(to: string, text: string): Promise<void> {
    this.sent.push({ to, text });
    const code = /\b(\d{6})\b/.exec(text)?.[1];
    if (code) this.lastCode.set(to, code);
  }
}

export interface TestContext {
  app: INestApplication;
  server: Parameters<typeof request>[0];
  sms: CapturingSms;
  db: Db;
  redis: Redis;
}

export async function createTestApp(
  overrides: { provide: symbol; useValue: unknown }[] = [],
): Promise<TestContext> {
  Object.assign(process.env, TEST_ENV);
  const sms = new CapturingSms();
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SMS_SENDER)
    .useValue(sms);
  for (const o of overrides) builder = builder.overrideProvider(o.provide).useValue(o.useValue);
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    rawBody: true,
    logger: false,
  });
  configureApp(app, app.get<Env>(ENV));
  await app.init();
  return {
    app,
    server: app.getHttpServer() as Parameters<typeof request>[0],
    sms,
    db: app.get<Db>(DB),
    redis: app.get<Redis>(REDIS),
  };
}

/** A random valid Nigerian mobile number in local format, plus its E.164 form. */
export function randomPhone(): { local: string; e164: string } {
  const rest = String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0');
  return { local: `0803${rest}`, e164: `+234803${rest}` };
}

export const CLIENT_HEADER = { 'x-gadmo-client': 'web' };

/** Signs up / logs in through the real OTP flow. Returns a cookie-keeping agent. */
export async function login(
  ctx: TestContext,
  opts: { role?: 'customer' | 'pro'; phone?: { local: string; e164: string } } = {},
): Promise<{ agent: TestAgent; userId: string; phone: { local: string; e164: string } }> {
  const phone = opts.phone ?? randomPhone();
  const agent = request.agent(ctx.server);
  await agent
    .post('/v1/auth/otp/request')
    .set(CLIENT_HEADER)
    .send({ phone: phone.local })
    .expect(202);
  const code = ctx.sms.lastCode.get(phone.e164);
  if (!code) throw new Error('no OTP captured');
  const res = await agent
    .post('/v1/auth/otp/verify')
    .set(CLIENT_HEADER)
    .send({ phone: phone.local, code, ...(opts.role ? { role: opts.role } : {}) })
    .expect(200);
  return { agent, userId: (res.body as { user: { id: string } }).user.id, phone };
}
