import { applyDecorators, createParamDecorator, SetMetadata, UseGuards, type ExecutionContext } from '@nestjs/common';
import { ApiCookieAuth, ApiParam } from '@nestjs/swagger';
import type { Request } from 'express';
import type { Permission, PlanFeature } from '@filafacil/shared';
import { ApiErrors } from '../../common/http/api-docs.js';
import { ESTABLISHMENT_ACCESS, PLATFORM_PERMISSION } from './access.constants.js';
import type { EstablishmentContext, EstablishmentRequirement } from './access.types.js';
import { EstablishmentAccessGuard } from './establishment-access.guard.js';
import { PlatformAccessGuard } from './platform-access.guard.js';

/** Controller de recursos de um estabelecimento: aplica o guard e documenta o parâmetro. */
export const EstablishmentScoped = () =>
  applyDecorators(
    UseGuards(EstablishmentAccessGuard),
    ApiCookieAuth(),
    ApiParam({ name: 'establishmentId', format: 'uuid', description: 'Estabelecimento ao qual o usuário está vinculado' }),
    ApiErrors(401, 403, 404),
  );

/** Exige uma das permissões (e, opcionalmente, um recurso do plano) no estabelecimento da rota. */
export const RequireAccess = (anyPermission: Permission[], feature?: PlanFeature) =>
  SetMetadata(ESTABLISHMENT_ACCESS, { anyPermission, feature } satisfies EstablishmentRequirement);

export const PlatformAdmin = (permission: Permission) =>
  applyDecorators(SetMetadata(PLATFORM_PERMISSION, permission), UseGuards(PlatformAccessGuard), ApiCookieAuth(), ApiErrors(401, 403));

export const CurrentEstablishment = createParamDecorator((_: unknown, context: ExecutionContext): EstablishmentContext => {
  const establishment = context.switchToHttp().getRequest<Request>().establishment;
  if (!establishment) throw new Error('CurrentEstablishment usado fora de uma rota com EstablishmentScoped().');
  return establishment;
});
