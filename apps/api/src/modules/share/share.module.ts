import { Module } from '@nestjs/common';
import { ShareVisitsController, StaffShareVisitsController } from './share.controller.js';

@Module({ controllers: [ShareVisitsController, StaffShareVisitsController] })
export class ShareModule {}
