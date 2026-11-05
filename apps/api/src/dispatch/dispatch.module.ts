import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ChooseProController } from './choose.controller';
import { DispatchService } from './dispatch.service';
import { OffersController } from './offers.controller';

@Module({
  imports: [AuthModule],
  providers: [DispatchService],
  controllers: [OffersController, ChooseProController],
  exports: [DispatchService],
})
export class DispatchModule {}
