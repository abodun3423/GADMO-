import { Module } from '@nestjs/common';
import { AccountController } from './account/account.controller';
import { AuthModule } from './auth/auth.module';
import { CatalogController } from './catalog/catalog.controller';
import { ConfigModule } from './config/config.module';
import { DispatchModule } from './dispatch/dispatch.module';
import { HealthController } from './health/health.controller';
import { InfraModule } from './infra/infra.module';
import { JobsController } from './jobs/jobs.controller';
import { ProController } from './pro/pro.controller';
import { VerificationController } from './verification/verification.controller';

@Module({
  imports: [ConfigModule, InfraModule, AuthModule, DispatchModule],
  controllers: [
    AccountController,
    HealthController,
    CatalogController,
    JobsController,
    ProController,
    VerificationController,
  ],
})
export class AppModule {}
