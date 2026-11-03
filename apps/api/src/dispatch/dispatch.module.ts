import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DispatchService } from './dispatch.service';
import { OffersController } from './offers.controller';

@Module({
  imports: [AuthModule],
  providers: [DispatchService],
  controllers: [OffersController],
  exports: [DispatchService],
})
export class DispatchModule {}
