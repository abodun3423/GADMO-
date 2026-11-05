import { Module } from '@nestjs/common';
import { AccountController } from './account/account.controller';
import { AdminUsersController } from './admin/users.controller';
import { AdminVerificationsController } from './admin/verifications.controller';
import { AuthModule } from './auth/auth.module';
import { CatalogController } from './catalog/catalog.controller';
import { ChatController } from './chat/chat.controller';
import { InspectionController } from './chat/inspection.controller';
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
    AdminUsersController,
    AdminVerificationsController,
    HealthController,
    CatalogController,
    ChatController,
    InspectionController,
    JobsController,
    ProController,
    VerificationController,
  ],
})
export class AppModule {}
