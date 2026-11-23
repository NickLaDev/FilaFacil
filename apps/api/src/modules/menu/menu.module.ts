import { Module } from '@nestjs/common';
import { MenuImportController } from './menu-import.controller.js';
import { MenuImportService } from './menu-import.service.js';
import { MenuController } from './menu.controller.js';
import { MenuRankingService } from './menu-ranking.service.js';
import { MenuService } from './menu.service.js';

@Module({
  controllers: [MenuImportController, MenuController],
  providers: [MenuService, MenuRankingService, MenuImportService],
})
export class MenuModule {}
