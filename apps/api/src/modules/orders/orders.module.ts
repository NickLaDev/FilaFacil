import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module.js';
import { RestaurantsModule } from '../restaurants/restaurants.module.js';
import { KitchenModule } from '../kitchen/kitchen.module.js';
import { LoyaltyModule } from '../loyalty/loyalty.module.js';
import { StockModule } from '../stock/stock.module.js';
import { ReadyNotifierService } from './ready-notifier.service.js';
import { OrderEffectsService } from './order-effects.service.js';
import { OrderPaymentsService } from './order-payments.service.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { PaymentsWebhookController } from './payments-webhook.controller.js';
import { StaffOrdersController } from './staff-orders.controller.js';

@Module({
  imports: [RestaurantsModule, PaymentsModule, LoyaltyModule, StockModule, KitchenModule],
  controllers: [OrdersController, StaffOrdersController, PaymentsWebhookController],
  providers: [OrdersService, OrderPaymentsService, OrderEffectsService, ReadyNotifierService],
})
export class OrdersModule {}
