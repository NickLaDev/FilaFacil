import { Body, Controller, Get, Header, Headers, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import type { PartnerApplicationCreatedDto, PartnerApplicationDto, PartnerApplicationsPage } from '@filafacil/shared';
import { ApiErrors } from '../../common/http/api-docs.js';
import { PlatformAdmin } from '../access/access.decorators.js';
import { CurrentAuth, Public } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import {
  ApprovePartnerDto,
  ListPartnerApplicationsQueryDto,
  PartnerApplicationDto as PartnerApplicationBodyDto,
  PartnerDecisionMessageDto,
  UpdatePartnerApplicationDto,
} from './partners.dto.js';
import { MAX_PARTNER_DOCUMENT_BYTES, PartnersService } from './partners.service.js';

/** Portal do novo parceiro (ficha 55): sem conta; o código de acompanhamento vai no cabeçalho `X-Partner-Token`. */
@ApiTags('Parceiros (cadastro)')
@Public()
@Controller('partner-applications')
export class PartnerApplicationsController {
  constructor(private readonly partners: PartnersService) {}

  @Post()
  @Throttle({ default: { limit: 5, ttl: 60 * 60_000 } })
  @ApiOperation({ summary: 'Envia o cadastro de um novo estabelecimento; devolve o código de acompanhamento (mostrado uma vez)' })
  @ApiErrors(400, 409, 422)
  apply(@Body() dto: PartnerApplicationBodyDto): Promise<PartnerApplicationCreatedDto> {
    return this.partners.apply(dto);
  }

  @Get('mine')
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @ApiOperation({ summary: 'Status do cadastro (pelo código de acompanhamento)' })
  @ApiErrors(401)
  mine(@Headers('x-partner-token') token: string | undefined): Promise<PartnerApplicationDto> {
    return this.partners.byToken(token);
  }

  @Patch('mine')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiOperation({ summary: 'Corrige os dados ou responde ao pedido de informação (volta para a fila)' })
  @ApiErrors(400, 401, 409, 422)
  update(@Headers('x-partner-token') token: string | undefined, @Body() dto: UpdatePartnerApplicationDto): Promise<PartnerApplicationDto> {
    return this.partners.updateByToken(token, dto);
  }

  @Post('mine/documents')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @UseInterceptors(FileInterceptor('file', { storage: memoryStorage(), limits: { fileSize: MAX_PARTNER_DOCUMENT_BYTES, files: 1, fields: 2, parts: 3 } }))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Anexa um documento (PDF ou imagem, até 5 MB; no máximo 5)' })
  @ApiErrors(400, 401, 409, 413, 422)
  addDocument(@Headers('x-partner-token') token: string | undefined, @UploadedFile() file: Express.Multer.File | undefined): Promise<PartnerApplicationDto> {
    return this.partners.addDocument(token, file);
  }
}

@ApiTags('Administração (parceiros)')
@PlatformAdmin('platform.partners')
@Controller('admin/partner-applications')
export class AdminPartnersController {
  constructor(private readonly partners: PartnersService) {}

  @Get()
  @ApiOperation({ summary: 'Fila de cadastros (por status, mais antigos primeiro)' })
  list(@Query() query: ListPartnerApplicationsQueryDto): Promise<PartnerApplicationsPage> {
    return this.partners.list(query);
  }

  @Get(':id')
  @ApiErrors(404)
  get(@Param('id', ParseUUIDPipe) id: string): Promise<PartnerApplicationDto> {
    return this.partners.get(id);
  }

  @Get(':id/documents/:documentId')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  @ApiOperation({ summary: 'Baixa um documento do cadastro (só a plataforma)' })
  @ApiErrors(404)
  async document(@Param('id', ParseUUIDPipe) id: string, @Param('documentId', ParseUUIDPipe) documentId: string, @Res() response: Response) {
    const doc = await this.partners.document(id, documentId);
    response.type(doc.contentType).attachment(doc.fileName).send(doc.content);
  }

  @Post(':id/approve')
  @ApiOperation({ summary: 'Aprova: cria rede, estabelecimento ativo e conta de gestor; avisa o parceiro' })
  @ApiErrors(404, 409, 422)
  approve(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ApprovePartnerDto, @CurrentAuth() auth: AuthContext): Promise<PartnerApplicationDto> {
    return this.partners.approve(id, dto.planId, auth);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Recusa com motivo (enviado ao parceiro)' })
  @ApiErrors(404, 409)
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PartnerDecisionMessageDto): Promise<PartnerApplicationDto> {
    return this.partners.reject(id, dto.message);
  }

  @Post(':id/request-info')
  @ApiOperation({ summary: 'Pede mais informações ao parceiro' })
  @ApiErrors(404, 409)
  requestInfo(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PartnerDecisionMessageDto): Promise<PartnerApplicationDto> {
    return this.partners.requestInfo(id, dto.message);
  }
}
