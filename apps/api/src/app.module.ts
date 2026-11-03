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

@Module({
  imports: [ConfigModule, InfraModule, AuthModule, DispatchModule],
  controllers: [
    AccountController,
    HealthController,
    CatalogController,
    JobsController,
    ProController,
  ],
})
export class AppModule {}
