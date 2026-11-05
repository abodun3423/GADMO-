import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { Env } from './config/env';
import { CSRF_HEADER } from './auth/guards';
import { AUDIO_TYPES, MAX_VOICE_BYTES } from './chat/media';
import { MAX_UPLOAD_BYTES, UPLOAD_IMAGE_TYPES } from './verification/images';

/** HTTP hardening shared by the real server and the integration tests. */
export function configureApp(app: NestExpressApplication, env: Env): void {
  app.set('trust proxy', 1); // behind one load balancer; makes req.ip the client address
  app.use(helmet());
  app.use(cookieParser());
  app.useBodyParser('json', { limit: '100kb' });
  // Identity photos are sent as raw image bytes (resized on the phone first).
  app.useBodyParser('raw', { type: [...UPLOAD_IMAGE_TYPES], limit: MAX_UPLOAD_BYTES });
  // Chat voice notes, as raw audio bytes.
  app.useBodyParser('raw', { type: [...AUDIO_TYPES], limit: MAX_VOICE_BYTES });
  app.enableCors({
    origin: env.WEB_ORIGIN,
    credentials: true,
    allowedHeaders: ['content-type', CSRF_HEADER],
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  });
  app.setGlobalPrefix('v1', { exclude: ['health'] });
  app.enableShutdownHooks();
}
