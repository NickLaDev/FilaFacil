import { Body, Controller, Get, Header, Post, Res, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional } from 'class-validator';
import type { Response } from 'express';
import { memoryStorage } from 'multer';
import type { MenuImportResultDto } from '@filafacil/shared';
import { badRequest } from '../../common/http/app-error.js';
import { ApiErrors } from '../../common/http/api-docs.js';
import { CurrentEstablishment, EstablishmentScoped, RequireAccess } from '../access/access.decorators.js';
import type { EstablishmentContext } from '../access/access.types.js';
import { menuImportTemplate } from './menu-import.js';
import { MenuImportService } from './menu-import.service.js';

const MAX_SHEET_BYTES = 1024 * 1024;
const SHEET_TYPES = ['text/csv', 'text/plain', 'application/csv', 'application/vnd.ms-excel', 'application/octet-stream', 'text/comma-separated-values'];

export class MenuImportFormDto {
  /** "true" = só valida, sem gravar. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true' || value === '1')
  @IsBoolean()
  dryRun?: boolean;
}

@ApiTags('Cardápio (equipe)')
@EstablishmentScoped()
@Controller('establishments/:establishmentId/menu/import')
export class MenuImportController {
  constructor(private readonly imports: MenuImportService) {}

  @Get('template')
  @RequireAccess(['menu.edit'])
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Modelo de planilha (CSV) para importar o cardápio (ficha 54)' })
  template(@Res() response: Response) {
    response.type('text/csv; charset=utf-8').attachment('modelo-cardapio.csv').send(menuImportTemplate());
  }

  @Post()
  @RequireAccess(['menu.edit'])
  @UseInterceptors(
    FileInterceptor('file', {
      storage: memoryStorage(),
      limits: { fileSize: MAX_SHEET_BYTES, files: 1, fields: 3, parts: 4 },
      fileFilter: (_request, file, callback) => {
        if (SHEET_TYPES.includes(file.mimetype) || file.originalname.toLowerCase().endsWith('.csv')) callback(null, true);
        else callback(badRequest('UNSUPPORTED_SPREADSHEET', 'Envie a planilha em CSV (no Excel: Salvar como → CSV).'), false);
      },
    }),
  )
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' }, dryRun: { type: 'boolean' } } } })
  @ApiOperation({ summary: 'Importa itens em massa: valida obrigatórios, cria/atualiza e devolve o relatório de sucesso e erro' })
  @ApiErrors(400, 413, 422)
  async import(
    @CurrentEstablishment() establishment: EstablishmentContext,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() form: MenuImportFormDto,
  ): Promise<MenuImportResultDto> {
    if (!file?.buffer.length) throw badRequest('MISSING_FILE', 'Selecione a planilha do cardápio.');
    const text = new TextDecoder('utf-8', { fatal: false }).decode(file.buffer);
    return this.imports.import(establishment.id, text, form.dryRun ?? false);
  }
}
