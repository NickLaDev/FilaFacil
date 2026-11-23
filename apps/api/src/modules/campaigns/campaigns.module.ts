import { Module } from '@nestjs/common';
import { CampaignsController, MyOffersController } from './campaigns.controller.js';
import { CampaignsService } from './campaigns.service.js';

@Module({ controllers: [CampaignsController, MyOffersController], providers: [CampaignsService], exports: [CampaignsService] })
export class CampaignsModule {}
