import { Module } from '@nestjs/common';
import { AdminBillingController, EstablishmentBillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';

@Module({ controllers: [AdminBillingController, EstablishmentBillingController], providers: [BillingService], exports: [BillingService] })
export class BillingModule {}
