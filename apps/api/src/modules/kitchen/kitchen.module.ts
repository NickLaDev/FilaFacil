import { Module } from '@nestjs/common';
import { AlertsService } from './alerts.service.js';
import { KitchenController } from './kitchen.controller.js';
import { PrinterDeviceController } from './printer-device.controller.js';
import { PrintersService } from './printers.service.js';
import { StationsService } from './stations.service.js';

@Module({
  controllers: [KitchenController, PrinterDeviceController],
  providers: [AlertsService, StationsService, PrintersService],
  exports: [AlertsService, PrintersService],
})
export class KitchenModule {}
