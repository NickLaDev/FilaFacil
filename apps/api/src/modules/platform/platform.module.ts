import { Module } from '@nestjs/common';
import { RestaurantsModule } from '../restaurants/restaurants.module.js';
import { OrganizationsService } from './organizations.service.js';
import { MemberOrganizationsController, PlatformController } from './platform.controller.js';
import { PlatformMetricsService } from './platform-metrics.service.js';

@Module({ imports: [RestaurantsModule], controllers: [PlatformController, MemberOrganizationsController], providers: [PlatformMetricsService, OrganizationsService], exports: [OrganizationsService] })
export class PlatformModule {}
