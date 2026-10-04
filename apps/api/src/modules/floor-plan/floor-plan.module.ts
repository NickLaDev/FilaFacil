import { Module } from '@nestjs/common';
import { FloorPlanController } from './floor-plan.controller.js';
import { FloorPlanService } from './floor-plan.service.js';

@Module({
  controllers: [FloorPlanController],
  providers: [FloorPlanService],
  exports: [FloorPlanService],
})
export class FloorPlanModule {}
