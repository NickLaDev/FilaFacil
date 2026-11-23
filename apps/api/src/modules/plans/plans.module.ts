import { Module } from '@nestjs/common';
import { PlanChangeService } from './plan-change.service.js';
import { PlansController } from './plans.controller.js';

@Module({ controllers: [PlansController], providers: [PlanChangeService] })
export class PlansModule {}
