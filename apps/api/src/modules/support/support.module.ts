import { Module } from '@nestjs/common';
import { AdminSupportController, EstablishmentSupportController } from './support.controller.js';
import { SupportService } from './support.service.js';

@Module({ controllers: [AdminSupportController, EstablishmentSupportController], providers: [SupportService] })
export class SupportModule {}
