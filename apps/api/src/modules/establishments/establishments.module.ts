import { Module } from '@nestjs/common';
import { EstablishmentPlanController } from './establishment-plan.controller.js';

@Module({
  controllers: [EstablishmentPlanController],
})
export class EstablishmentsModule {}
