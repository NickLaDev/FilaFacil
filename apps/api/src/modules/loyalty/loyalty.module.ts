import { Module } from '@nestjs/common';
import { BenefitsModule } from '../benefits/benefits.module.js';
import { LoyaltyController } from './loyalty.controller.js';
import { LoyaltyService } from './loyalty.service.js';

@Module({ imports: [BenefitsModule], controllers: [LoyaltyController], providers: [LoyaltyService], exports: [LoyaltyService] })
export class LoyaltyModule {}
