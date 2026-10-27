import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrors } from '../../common/http/api-docs.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import type { OnboardingStateDto } from '@filafacil/shared';
import { CompleteOnboardingDto, CreateAddressDto, UpdateAddressDto, UpdateProfileDto } from './dto/me.dto.js';
import { AddressResponseDto, MeResponseDto } from './dto/me-responses.dto.js';
import { MeService } from './me.service.js';

@ApiTags('Perfil')
@ApiCookieAuth()
@ApiErrors(401, 403)
@Controller('me')
export class MeController {
  constructor(private readonly me: MeService) {}

  @Get()
  @ApiOperation({ summary: 'Dados da conta logada, permissões e estabelecimentos vinculados' })
  get(@CurrentAuth() auth: AuthContext): Promise<MeResponseDto> {
    return this.me.getMe(auth.userId);
  }

  @Patch()
  @ApiOperation({ summary: 'Edita nome, e-mail e celular (ficha 13)' })
  @ApiErrors(400, 409, 422)
  update(@CurrentAuth() auth: AuthContext, @Body() dto: UpdateProfileDto): Promise<MeResponseDto> {
    return this.me.updateProfile(auth.userId, dto);
  }

  @Get('onboarding')
  @ApiOperation({ summary: 'Se a conta já viu (ou pulou) o onboarding do primeiro acesso (ficha 07)' })
  onboarding(@CurrentAuth() auth: AuthContext): Promise<OnboardingStateDto> {
    return this.me.onboarding(auth.userId);
  }

  @Post('onboarding/complete')
  @HttpCode(200)
  @ApiOperation({ summary: 'Marca o onboarding como concluído ou pulado; idempotente' })
  completeOnboarding(@CurrentAuth() auth: AuthContext, @Body() dto: CompleteOnboardingDto): Promise<OnboardingStateDto> {
    void dto; // `skipped` é só informativo: concluir e pular marcam a conta do mesmo jeito
    return this.me.completeOnboarding(auth.userId);
  }

  @Get('addresses')
  @ApiOperation({ summary: 'Endereços salvos (o padrão vem primeiro)' })
  listAddresses(@CurrentAuth() auth: AuthContext): Promise<AddressResponseDto[]> {
    return this.me.listAddresses(auth.userId);
  }

  @Post('addresses')
  @ApiOperation({ summary: 'Salva um endereço; o primeiro vira padrão' })
  @ApiErrors(400, 422)
  createAddress(@CurrentAuth() auth: AuthContext, @Body() dto: CreateAddressDto): Promise<AddressResponseDto> {
    return this.me.createAddress(auth.userId, dto);
  }

  @Patch('addresses/:addressId')
  @ApiOperation({ summary: 'Edita um endereço ou o torna padrão' })
  @ApiErrors(400, 404)
  updateAddress(
    @CurrentAuth() auth: AuthContext,
    @Param('addressId', ParseUUIDPipe) addressId: string,
    @Body() dto: UpdateAddressDto,
  ): Promise<AddressResponseDto> {
    return this.me.updateAddress(auth.userId, addressId, dto);
  }

  @Delete('addresses/:addressId')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove um endereço' })
  @ApiErrors(404)
  async deleteAddress(@CurrentAuth() auth: AuthContext, @Param('addressId', ParseUUIDPipe) addressId: string) {
    await this.me.deleteAddress(auth.userId, addressId);
  }
}
