import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AdminEstablishmentsController } from './admin-establishments.controller.js';
import { AdminEstablishmentsService } from './admin-establishments.service.js';
import { AdminPlansController } from './admin-plans.controller.js';
import { AdminPlansService } from './admin-plans.service.js';
import { AdminUsersController } from './admin-users.controller.js';
import { AdminUsersService } from './admin-users.service.js';

@Module({
  imports: [AuthModule],
  controllers: [AdminEstablishmentsController, AdminUsersController, AdminPlansController],
  providers: [AdminEstablishmentsService, AdminUsersService, AdminPlansService],
})
export class AdminModule {}
