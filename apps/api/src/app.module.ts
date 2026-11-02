import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { CatalogController } from './catalog/catalog.controller';
import { ConfigModule } from './config/config.module';
import { HealthController } from './health/health.controller';
import { InfraModule } from './infra/infra.module';
import { JobsController } from './jobs/jobs.controller';

@Module({
  imports: [ConfigModule, InfraModule, AuthModule],
  controllers: [HealthController, CatalogController, JobsController],
})
export class AppModule {}
