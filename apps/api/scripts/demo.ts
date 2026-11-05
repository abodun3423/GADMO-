/**
 * GADMO local walkthrough: exercises everything built so far against your local database
 * and prints a plain-English result for each check. Run with: pnpm demo
 *
 * It starts the API in-process and captures login codes instead of sending SMS, so you
 * do not need an SMS account. It creates a few test users and jobs in your LOCAL database.
 */
import 'reflect-metadata';
import {
  formatNaira,
  MAX_INSPECTION_FEE_KOBO,
  splitPayout,
  COMMISSION_BPS,
  validateInspectionFee,
} from '@gadmo/shared';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { SMS_SENDER, type SmsSender } from '../src/auth/sms';
import { ENV, type Env } from '../src/config/env';
import { loadDotEnv } from '../src/config/load-dotenv';
import { configureApp } from '../src/configure-app';

const H = { 'x-gadmo-client': 'web' };
let passed = 0;
let failed = 0;

function check(ok: boolean, label: string, detail = ''): void {
  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? '✔' : '✘'} ${label}${detail ? ` — ${detail}` : ''}`);
}

function section(title: string): void {
  console.log(`\n${title}`);
}

class CapturedSms implements SmsSender {
  readonly codes = new Map<string, string>();
  async send(to: string, text: string): Promise<void> {
    const code = /\b(\d{6})\b/.exec(text)?.[1];
    if (code) this.codes.set(to, code);
  }
}

function randomPhone() {
  const rest = String(Math.floor(Math.random() * 10_000_000)).padStart(7, '0');
  return { local: `0803${rest}`, e164: `+234803${rest}` };
}

async function main(): Promise<void> {
  loadDotEnv();
  const sms = new CapturedSms();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SMS_SENDER)
    .useValue(sms)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({
    bodyParser: false,
    rawBody: true,
    logger: false,
  });
  configureApp(app, app.get<Env>(ENV));
  await app.init();
  const server = app.getHttpServer() as Parameters<typeof request>[0];

  const signUp = async (role: 'customer' | 'pro') => {
    const phone = randomPhone();
    const agent = request.agent(server);
    await agent.post('/v1/auth/otp/request').set(H).send({ phone: phone.local });
    const code = sms.codes.get(phone.e164)!;
    const res = await agent
      .post('/v1/auth/otp/verify')
      .set(H)
      .send({ phone: phone.local, code, role });
    return { agent, phone, code, id: (res.body as { user: { id: string } }).user.id, res };
  };

  console.log('GADMO local walkthrough');

  section('1. Server and catalogue');
  const health = await request(server).get('/health');
  check(health.status === 200, 'Database and Redis are reachable');
  const cat = await request(server).get('/v1/categories');
  const groups = (
    cat.body as {
      groups: {
        name: string;
        categories: { id: string; slug: string; inspectionPolicy: string }[];
      }[];
    }
  ).groups;
  const all = groups.flatMap((g) => g.categories);
  check(all.length > 100, `${groups.length} groups, ${all.length} categories loaded`);
  const policy = (slug: string) => all.find((c) => c.slug === slug)?.inspectionPolicy;
  check(policy('electrician') === 'REQUIRED', 'Electrician needs an inspection fee');
  check(
    policy('web-developer') === 'NONE' && policy('event-hall') === 'NONE',
    'Web developer and event hall have no inspection fee',
  );

  section('2. Phone login');
  const ada = await signUp('customer');
  console.log(
    `    (code sent to ${ada.phone.local}: ${ada.code} — in production this arrives by SMS)`,
  );
  check(ada.res.status === 200, 'A new customer signs up with phone + code');
  const wrongPhone = randomPhone();
  await request(server).post('/v1/auth/otp/request').set(H).send({ phone: wrongPhone.local });
  const right = sms.codes.get(wrongPhone.e164)!;
  const wrong = await request(server)
    .post('/v1/auth/otp/verify')
    .set(H)
    .send({ phone: wrongPhone.local, code: right === '000000' ? '111111' : '000000' });
  check(wrong.status === 401, 'A wrong code is rejected');
  const admin = await request(server)
    .post('/v1/auth/otp/verify')
    .set(H)
    .send({ phone: wrongPhone.local, code: right, role: 'admin' });
  check(admin.status === 400, 'Nobody can sign themselves up as an admin');

  section('3. No contact details, ever');
  const electrician = all.find((c) => c.slug === 'electrician')!;
  const job = await ada.agent.post('/v1/jobs').set(H).send({
    categoryId: electrician.id,
    type: 'EMERGENCY',
    description: 'Lights went off in my shop. Call me on 0803 123 4567 or ada@gmail.com',
    latitude: 7.6233,
    longitude: 5.2209,
  });
  const description = (job.body as { job: { id: string; description: string } }).job.description;
  console.log(
    `    customer typed: "Lights went off in my shop. Call me on 0803 123 4567 or ada@gmail.com"`,
  );
  console.log(`    GADMO stored:   "${description}"`);
  check(
    job.status === 201 && !/0803|ada@/.test(description),
    'Phone number and email are hidden in the job description',
  );
  const pro = await signUp('pro');
  const profile = await pro.agent.get(`/v1/users/${ada.id}`);
  check(
    profile.status === 200 && !JSON.stringify(profile.body).includes(ada.phone.e164.slice(4)),
    'A Pro viewing a customer profile never sees their phone number',
  );

  section('4. Privacy between users');
  const jobId = (job.body as { job: { id: string } }).job.id;
  const bola = await signUp('customer');
  check(
    (await bola.agent.get(`/v1/jobs/${jobId}`)).status === 404,
    "Another customer cannot see Ada's job",
  );
  check(
    (await pro.agent.get(`/v1/jobs/${jobId}`)).status === 404,
    'A Pro not assigned to the job cannot see it',
  );
  check((await ada.agent.get(`/v1/jobs/${jobId}`)).status === 200, 'Ada can see her own job');
  check(
    (
      await pro.agent.post('/v1/jobs').set(H).send({
        categoryId: electrician.id,
        type: 'EMERGENCY',
        description: 'Pros should not be able to post jobs',
        latitude: 7.62,
        longitude: 5.22,
      })
    ).status === 403,
    'Pros cannot post customer jobs',
  );

  section('5. Security basics');
  check(
    (await request(server).post('/v1/auth/otp/request').send({ phone: randomPhone().local }))
      .status === 403,
    'Requests from other websites are blocked (CSRF protection)',
  );
  check((await request(server).get('/v1/jobs')).status === 401, 'Signed-out users get nothing');
  await ada.agent.post('/v1/auth/logout').set(H);
  check(
    (await ada.agent.post('/v1/auth/refresh').set(H)).status === 401,
    'After logout the session cannot be renewed',
  );

  section('6. Money rules');
  let capped = false;
  try {
    validateInspectionFee(600_000);
  } catch {
    capped = true;
  }
  check(capped, `Inspection fee above ${formatNaira(MAX_INSPECTION_FEE_KOBO)} is refused`);
  const split = splitPayout(2_700_000, COMMISSION_BPS);
  check(
    split.commissionKobo === 270_000,
    `On a ${formatNaira(2_700_000)} balance, GADMO keeps ${formatNaira(split.commissionKobo)} (10%) and the Pro gets ${formatNaira(split.proPayoutKobo)}`,
  );

  await app.close();
  console.log(`\n${passed} passed, ${failed} failed`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error('\nThe walkthrough could not run:', err instanceof Error ? err.message : err);
  console.error('Is the database running, and have you run "pnpm setup:local"?');
  process.exit(1);
});
