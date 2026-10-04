import { Injectable, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { isUUID } from 'class-validator';
import { notFound, unauthorized } from '../../common/http/app-error.js';
import type { EstablishmentRequirement } from './access.types.js';
import { ESTABLISHMENT_ACCESS } from './access.constants.js';
import { EntitlementsService } from './entitlements.service.js';

/**
 * Rotas /establishments/:establishmentId/... — o id da rota nunca é confiado: o guard confere
 * se a sessão tem vínculo com aquele estabelecimento antes de qualquer acesso aos dados.
 */
@Injectable()
export class EstablishmentAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly entitlements: EntitlementsService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<Request>();
    const requirement = this.reflector.getAllAndOverride<EstablishmentRequirement | undefined>(ESTABLISHMENT_ACCESS, [
      context.getHandler(),
      context.getClass(),
    ]) ?? { anyPermission: [] };
    if (!request.auth) throw unauthorized('AUTH_REQUIRED', 'Faça login para continuar.');
    const establishmentId = request.params.establishmentId;
    if (typeof establishmentId !== 'string' || !isUUID(establishmentId)) throw notFound('Estabelecimento não encontrado.');
    request.establishment = await this.entitlements.authorize(request.auth, establishmentId, requirement);
    return true;
  }
}
