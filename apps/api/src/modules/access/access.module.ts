import { Global, Module } from '@nestjs/common';
import { EntitlementsService } from './entitlements.service.js';
import { EstablishmentAccessGuard } from './establishment-access.guard.js';
import { PlatformAccessGuard } from './platform-access.guard.js';

@Global()
@Module({
  providers: [EntitlementsService, EstablishmentAccessGuard, PlatformAccessGuard],
  exports: [EntitlementsService, EstablishmentAccessGuard, PlatformAccessGuard],
})
export class AccessModule {}
