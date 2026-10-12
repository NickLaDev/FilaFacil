import { Module } from '@nestjs/common';
import { WaitlistModule } from '../waitlist/waitlist.module.js';
import { TableCallsController } from './table-calls.controller.js';
import { TablesController } from './tables.controller.js';
import { TablesService } from './tables.service.js';

@Module({
  imports: [WaitlistModule],
  controllers: [TablesController, TableCallsController],
  providers: [TablesService],
  exports: [TablesService],
})
export class TablesModule {}
