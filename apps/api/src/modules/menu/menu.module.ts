import { Module } from '@nestjs/common';
import { MenuController } from './menu.controller.js';
import { MenuRankingService } from './menu-ranking.service.js';
import { MenuService } from './menu.service.js';

@Module({
  controllers: [MenuController],
  providers: [MenuService, MenuRankingService],
})
export class MenuModule {}
