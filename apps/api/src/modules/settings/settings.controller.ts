import { Body, Controller, Get, HttpCode, Param, Post, Put } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsDefined, IsOptional } from 'class-validator';
import type { PlatformSettingDto, PublicFeaturesDto, SettingImpactDto } from '@filafacil/shared';
import { ApiErrors } from '../../common/http/api-docs.js';
import { PlatformAdmin } from '../access/access.decorators.js';
import { CurrentAuth, Public } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { SettingsService } from './settings.service.js';

class SettingValueDto {
  /** Booleano (flag) ou número inteiro (parâmetro), conforme o catálogo. */
  @IsDefined()
  value!: boolean | number;

  /** Obrigatório para alteração crítica, depois de ver o impacto. */
  @IsOptional()
  @IsBoolean()
  confirm?: boolean;
}

@ApiTags('Admin · Configurações')
@PlatformAdmin('platform.settings')
@Controller('admin/settings')
export class SettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Configurações gerais e flags da plataforma (ficha 43)' })
  list(): Promise<PlatformSettingDto[]> {
    return this.settings.list();
  }

  @Post(':key/impact')
  @HttpCode(200)
  @ApiOperation({ summary: 'Mostra o impacto de uma alteração antes de salvar' })
  @ApiErrors(404, 422)
  impact(@Param('key') key: string, @Body() dto: SettingValueDto): Promise<SettingImpactDto> {
    return this.settings.impact(key, dto.value);
  }

  @Put(':key')
  @ApiOperation({ summary: 'Altera a configuração (vale em até 1 minuto, sem deploy). Crítica exige confirm: true' })
  @ApiErrors(404, 409, 422)
  update(@Param('key') key: string, @Body() dto: SettingValueDto, @CurrentAuth() auth: AuthContext): Promise<PlatformSettingDto> {
    return this.settings.update(key, dto.value, auth.userId, dto.confirm === true);
  }
}

@ApiTags('Plataforma')
@Public()
@Controller('platform/features')
export class PublicFeaturesController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Funcionalidades ligadas na plataforma (o app esconde o que está desligado)' })
  features(): Promise<PublicFeaturesDto> {
    return this.settings.publicFeatures();
  }
}
