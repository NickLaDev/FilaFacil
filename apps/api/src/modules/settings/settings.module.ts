import { Global, Module } from '@nestjs/common';
import { PublicFeaturesController, SettingsController } from './settings.controller.js';
import { SettingsService } from './settings.service.js';

@Global()
@Module({ controllers: [SettingsController, PublicFeaturesController], providers: [SettingsService], exports: [SettingsService] })
export class SettingsModule {}
