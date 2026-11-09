import { Module } from '@nestjs/common';
import { KitchenModule } from '../kitchen/kitchen.module.js';
import { IngredientLotsController } from './ingredient-lots.controller.js';
import { IngredientLotsService } from './ingredient-lots.service.js';

@Module({ imports: [KitchenModule], controllers: [IngredientLotsController], providers: [IngredientLotsService], exports: [IngredientLotsService] })
export class IngredientLotsModule {}
