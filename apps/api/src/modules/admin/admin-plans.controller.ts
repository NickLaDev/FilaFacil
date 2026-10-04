import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrors } from '../../common/http/api-docs.js';
import { PlatformAdmin } from '../access/access.decorators.js';
import { AdminPlansService } from './admin-plans.service.js';
import { CreatePlanDto, UpdatePlanDto } from './dto/admin-plans.dto.js';
import { PlanResponseDto } from './dto/admin-responses.dto.js';

@ApiTags('Admin · Planos')
@PlatformAdmin('platform.plans')
@Controller('admin/plans')
export class AdminPlansController {
  constructor(private readonly plans: AdminPlansService) {}

  @Get()
  @ApiOperation({ summary: 'Planos com preço, limites, recursos e quantidade de estabelecimentos (ficha 37)' })
  list(): Promise<PlanResponseDto[]> {
    return this.plans.list();
  }

  @Post()
  @ApiOperation({ summary: 'Cria um plano' })
  @ApiErrors(400, 409)
  create(@Body() dto: CreatePlanDto): Promise<PlanResponseDto> {
    return this.plans.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Edita preço, limites ou recursos (vale na hora para todos os estabelecimentos do plano)' })
  @ApiErrors(400, 404, 409)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePlanDto): Promise<PlanResponseDto> {
    return this.plans.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Exclui um plano sem estabelecimentos' })
  @ApiErrors(404, 409)
  async remove(@Param('id', ParseUUIDPipe) id: string) {
    await this.plans.remove(id);
  }
}
