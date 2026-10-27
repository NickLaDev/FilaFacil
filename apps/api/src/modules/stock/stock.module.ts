import { Module } from '@nestjs/common';
import { KitchenModule } from '../kitchen/kitchen.module.js';
import { StockController } from './stock.controller.js';
import { StockService } from './stock.service.js';

@Module({ imports: [KitchenModule], controllers: [StockController], providers: [StockService], exports: [StockService] })
export class StockModule {}
