import { Module } from '@nestjs/common';
import { TechnicalSheetsController } from './technical-sheets.controller.js';
import { TechnicalSheetsService } from './technical-sheets.service.js';

@Module({
  controllers: [TechnicalSheetsController],
  providers: [TechnicalSheetsService],
})
export class TechnicalSheetsModule {}
