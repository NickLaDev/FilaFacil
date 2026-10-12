import { Module } from '@nestjs/common';
import { RestaurantsModule } from '../restaurants/restaurants.module.js';
import { MyReservationsController, ReservationsController } from './reservations.controller.js';
import { WaitlistController } from './waitlist.controller.js';
import { WaitlistService } from './waitlist.service.js';

@Module({
  imports: [RestaurantsModule],
  controllers: [WaitlistController, ReservationsController, MyReservationsController],
  providers: [WaitlistService],
  exports: [WaitlistService],
})
export class WaitlistModule {}
