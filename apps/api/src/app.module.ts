import { Module } from '@nestjs/common';
import { AccountController } from './account/account.controller';
import { AdminJobMatchingController } from './admin/job-matching.controller';
import { AdminUsersController } from './admin/users.controller';
import { AdminVerificationsController } from './admin/verifications.controller';
import { AlertsModule } from './alerts/alerts.module';
import { AuthModule } from './auth/auth.module';
import { CatalogController } from './catalog/catalog.controller';
import { ChatController } from './chat/chat.controller';
import { InspectionController } from './chat/inspection.controller';
import { ConfigModule } from './config/config.module';
import { DispatchModule } from './dispatch/dispatch.module';
import { HealthController } from './health/health.controller';
import { InfraModule } from './infra/infra.module';
import { JobsController } from './jobs/jobs.controller';
import { PaymentsModule } from './payments/payments.module';
import { ProController } from './pro/pro.controller';
import { VisitController } from './visit/visit.controller';
import { VerificationController } from './verification/verification.controller';

@Module({
  imports: [ConfigModule, InfraModule, AuthModule, AlertsModule, DispatchModule, PaymentsModule],
  controllers: [
    AccountController,
    AdminJobMatchingController,
    AdminUsersController,
    AdminVerificationsController,
    HealthController,
    CatalogController,
    ChatController,
    InspectionController,
    JobsController,
    ProController,
    VerificationController,
    VisitController,
  ],
})
export class AppModule {}
