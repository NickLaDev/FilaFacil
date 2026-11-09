import { Global, Module } from '@nestjs/common';
import { ChangeLogService } from './change-log.service.js';
import { EstablishmentHistoryController } from './establishment-history.controller.js';

@Global()
@Module({ controllers: [EstablishmentHistoryController], providers: [ChangeLogService], exports: [ChangeLogService] })
export class EstablishmentHistoryModule {}
