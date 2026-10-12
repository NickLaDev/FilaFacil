import { Module } from '@nestjs/common';
import { PaymentsModule } from '../payments/payments.module.js';
import { RestaurantsModule } from '../restaurants/restaurants.module.js';
import { OrderPaymentsService } from './order-payments.service.js';
import { OrdersController } from './orders.controller.js';
import { OrdersService } from './orders.service.js';
import { PaymentsWebhookController } from './payments-webhook.controller.js';
import { StaffOrdersController } from './staff-orders.controller.js';

@Module({
  imports: [RestaurantsModule, PaymentsModule],
  controllers: [OrdersController, StaffOrdersController, PaymentsWebhookController],
  providers: [OrdersService, OrderPaymentsService],
})
export class OrdersModule {}
