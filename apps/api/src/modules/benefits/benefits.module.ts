import { Module } from '@nestjs/common';
import { BenefitsController, RestaurantBenefitsController } from './benefits.controller.js';
import { BenefitsService } from './benefits.service.js';
import { ManagerBenefitsController } from './manager-benefits.controller.js';
import { ManagerBenefitsService } from './manager-benefits.service.js';

@Module({
  controllers: [BenefitsController, RestaurantBenefitsController, ManagerBenefitsController],
  providers: [BenefitsService, ManagerBenefitsService],
  exports: [BenefitsService],
})
export class BenefitsModule {}
