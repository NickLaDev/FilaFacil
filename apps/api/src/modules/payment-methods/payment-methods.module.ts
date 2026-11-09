import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module.js';
import { PaymentMethodsController } from './payment-methods.controller.js';
import { PaymentMethodsService } from './payment-methods.service.js';

@Module({ imports: [PaymentsModule], controllers: [PaymentMethodsController], providers: [PaymentMethodsService], exports: [PaymentMethodsService] })
export class PaymentMethodsModule {}
