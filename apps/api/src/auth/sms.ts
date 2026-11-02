import { Injectable, Logger } from '@nestjs/common';
import { redactPhone } from '@gadmo/shared';

export const SMS_SENDER = Symbol('SMS_SENDER');

export interface SmsSender {
  send(toE164: string, text: string): Promise<void>;
}

/**
 * Development only: prints the message instead of sending it.
 * Startup refuses this provider when NODE_ENV=production (see config/env.ts).
 */
@Injectable()
export class ConsoleSmsSender implements SmsSender {
  private readonly logger = new Logger('DevSMS');

  async send(toE164: string, text: string): Promise<void> {
    this.logger.warn(`to ${redactPhone(toE164)}: ${text}`);
  }
}
