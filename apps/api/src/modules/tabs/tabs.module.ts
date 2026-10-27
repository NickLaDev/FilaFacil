import { Module } from '@nestjs/common';
import { KitchenModule } from '../kitchen/kitchen.module.js';
import { LoyaltyModule } from '../loyalty/loyalty.module.js';
import { PaymentsModule } from '../payments/payments.module.js';
import { WaitlistModule } from '../waitlist/waitlist.module.js';
import { TabsController } from './tabs.controller.js';
import { TabsService } from './tabs.service.js';

@Module({ imports: [PaymentsModule, WaitlistModule, LoyaltyModule, KitchenModule], controllers: [TabsController], providers: [TabsService], exports: [TabsService] })
export class TabsModule {}
