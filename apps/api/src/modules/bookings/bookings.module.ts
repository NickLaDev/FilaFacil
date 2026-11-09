import { Module } from '@nestjs/common';
import { BookingsController, StaffBookingsController } from './bookings.controller.js';
import { BookingsService } from './bookings.service.js';

@Module({ controllers: [BookingsController, StaffBookingsController], providers: [BookingsService], exports: [BookingsService] })
export class BookingsModule {}
