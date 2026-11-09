import { Module } from '@nestjs/common';
import { AdminMonitoringController, IntegrationDeviceController } from './monitoring.controller.js';
import { MonitoringService } from './monitoring.service.js';

@Module({ controllers: [AdminMonitoringController, IntegrationDeviceController], providers: [MonitoringService], exports: [MonitoringService] })
export class MonitoringModule {}
