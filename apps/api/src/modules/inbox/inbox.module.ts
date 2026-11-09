import { Global, Module } from '@nestjs/common';
import { MyNotificationsController, StaffNotificationsController } from './inbox.controller.js';
import { InboxService } from './inbox.service.js';

@Global()
@Module({ controllers: [MyNotificationsController, StaffNotificationsController], providers: [InboxService], exports: [InboxService] })
export class InboxModule {}
