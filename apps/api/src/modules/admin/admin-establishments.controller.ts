import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrors } from '../../common/http/api-docs.js';
import { PlatformAdmin } from '../access/access.decorators.js';
import { ImageFileInterceptor } from '../storage/image-upload.interceptor.js';
import { AdminEstablishmentsService } from './admin-establishments.service.js';
import {
  CreateEstablishmentDto,
  CreateOrganizationDto,
  ListEstablishmentsQueryDto,
  SetEstablishmentPlanDto,
  SetEstablishmentStatusDto,
  UpdateEstablishmentDto,
} from './dto/admin-establishments.dto.js';
import { AdminEstablishmentResponseDto, AdminEstablishmentsPageDto, OrganizationResponseDto } from './dto/admin-responses.dto.js';

const UPLOAD_LIMIT_BYTES = 10 * 1024 * 1024;

@ApiTags('Admin · Estabelecimentos')
@PlatformAdmin('platform.establishments')
@Controller('admin')
export class AdminEstablishmentsController {
  constructor(private readonly establishments: AdminEstablishmentsService) {}

  @Get('establishments')
  @ApiOperation({ summary: 'Lista paginada com busca, filtro por status e contagem por status (ficha 34)' })
  list(@Query() query: ListEstablishmentsQueryDto): Promise<AdminEstablishmentsPageDto> {
    return this.establishments.list(query);
  }

  @Get('establishments/:id')
  @ApiOperation({ summary: 'Detalhe do estabelecimento' })
  @ApiErrors(404)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<AdminEstablishmentResponseDto> {
    return this.establishments.get(id);
  }

  @Post('establishments')
  @ApiOperation({ summary: 'Cadastra um estabelecimento vinculado a uma organização e a um plano' })
  @ApiErrors(400, 422)
  create(@Body() dto: CreateEstablishmentDto): Promise<AdminEstablishmentResponseDto> {
    return this.establishments.create(dto);
  }

  @Patch('establishments/:id')
  @ApiOperation({ summary: 'Edita dados, localização e horários de funcionamento' })
  @ApiErrors(400, 404, 422)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEstablishmentDto): Promise<AdminEstablishmentResponseDto> {
    return this.establishments.update(id, dto);
  }

  @Patch('establishments/:id/status')
  @ApiOperation({ summary: 'Ativa, desativa ou suspende (inativo/suspenso some do cliente na hora)' })
  @ApiErrors(400, 404)
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetEstablishmentStatusDto): Promise<AdminEstablishmentResponseDto> {
    return this.establishments.setStatus(id, dto.status);
  }

  @Put('establishments/:id/plan')
  @ApiOperation({ summary: 'Migra o estabelecimento de plano (recursos liberados/bloqueados na hora, ficha 37)' })
  @ApiErrors(400, 404, 422)
  setPlan(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetEstablishmentPlanDto): Promise<AdminEstablishmentResponseDto> {
    return this.establishments.setPlan(id, dto.planId);
  }

  @Post('establishments/:id/photos')
  @UseInterceptors(ImageFileInterceptor(UPLOAD_LIMIT_BYTES))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Adiciona uma foto à galeria (PNG, JPG ou WEBP)' })
  @ApiErrors(400, 404, 413, 422)
  addPhoto(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Express.Multer.File | undefined): Promise<AdminEstablishmentResponseDto> {
    return this.establishments.addPhoto(id, file);
  }

  @Delete('establishments/:id/photos/:photoId')
  @ApiOperation({ summary: 'Remove uma foto da galeria' })
  @ApiErrors(404)
  removePhoto(@Param('id', ParseUUIDPipe) id: string, @Param('photoId', ParseUUIDPipe) photoId: string): Promise<AdminEstablishmentResponseDto> {
    return this.establishments.removePhoto(id, photoId);
  }

  @Get('organizations')
  @ApiOperation({ summary: 'Organizações (redes/grupos) para vincular estabelecimentos' })
  listOrganizations(): Promise<OrganizationResponseDto[]> {
    return this.establishments.listOrganizations();
  }

  @Post('organizations')
  @ApiOperation({ summary: 'Cadastra uma organização' })
  @ApiErrors(400, 409)
  createOrganization(@Body() dto: CreateOrganizationDto): Promise<OrganizationResponseDto> {
    return this.establishments.createOrganization(dto.name);
  }
}
