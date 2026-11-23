import { Module } from '@nestjs/common';
import { AdminPartnersController, PartnerApplicationsController } from './partners.controller.js';
import { PartnersService } from './partners.service.js';

@Module({
  controllers: [PartnerApplicationsController, AdminPartnersController],
  providers: [PartnersService],
})
export class PartnersModule {}
