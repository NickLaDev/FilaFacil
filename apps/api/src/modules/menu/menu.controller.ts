import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { ApiBody, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiErrors } from '../../common/http/api-docs.js';
import { PageQueryDto } from '../../common/pagination/page-query.dto.js';
import { CurrentEstablishment, EstablishmentScoped, RequireAccess } from '../access/access.decorators.js';
import type { EstablishmentContext } from '../access/access.types.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { ImageFileInterceptor } from '../storage/image-upload.interceptor.js';
import { CreateMenuItemDto, SetAvailabilityDto, UpdateMenuItemDto } from './dto/menu.dto.js';
import { AvailabilityHistoryPageDto, ManagedMenuItemDto, MenuCategoryResponseDto } from './dto/menu-responses.dto.js';
import { MenuService } from './menu.service.js';

/** Limite do interceptor de upload; a validação fina (tamanho/conteúdo) fica no ImageUploadService. */
const UPLOAD_LIMIT_BYTES = 10 * 1024 * 1024;

@ApiTags('Cardápio (equipe)')
@EstablishmentScoped()
@Controller('establishments/:establishmentId/menu')
export class MenuController {
  constructor(private readonly menu: MenuService) {}

  @Get('items')
  @RequireAccess(['menu.edit', 'menu.availability'])
  @ApiOperation({ summary: 'Todos os itens do cardápio, inclusive esgotados' })
  listItems(@CurrentEstablishment() establishment: EstablishmentContext): Promise<ManagedMenuItemDto[]> {
    return this.menu.listItems(establishment.id);
  }

  @Get('categories')
  @RequireAccess(['menu.edit'])
  @ApiOperation({ summary: 'Categorias do cardápio, na ordem de exibição' })
  listCategories(@CurrentEstablishment() establishment: EstablishmentContext): Promise<MenuCategoryResponseDto[]> {
    return this.menu.listCategories(establishment.id);
  }

  @Post('items')
  @RequireAccess(['menu.edit'])
  @ApiOperation({ summary: 'Cadastra um item (ficha 28)' })
  @ApiErrors(400)
  create(@CurrentEstablishment() establishment: EstablishmentContext, @Body() dto: CreateMenuItemDto): Promise<ManagedMenuItemDto> {
    return this.menu.createItem(establishment.id, dto);
  }

  @Patch('items/:itemId')
  @RequireAccess(['menu.edit'])
  @ApiOperation({ summary: 'Edita nome, descrição, preço, categoria ou foto por link (ficha 28)' })
  @ApiErrors(400)
  update(
    @CurrentEstablishment() establishment: EstablishmentContext,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: UpdateMenuItemDto,
  ): Promise<ManagedMenuItemDto> {
    return this.menu.updateItem(establishment.id, itemId, dto);
  }

  @Delete('items/:itemId')
  @HttpCode(204)
  @RequireAccess(['menu.edit'])
  @ApiOperation({ summary: 'Exclui o item do cardápio (exclusão lógica; sai das promoções)' })
  async remove(@CurrentEstablishment() establishment: EstablishmentContext, @Param('itemId', ParseUUIDPipe) itemId: string) {
    await this.menu.deleteItem(establishment.id, itemId);
  }

  @Put('items/:itemId/photo')
  @RequireAccess(['menu.edit'])
  @UseInterceptors(ImageFileInterceptor(UPLOAD_LIMIT_BYTES))
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', required: ['file'], properties: { file: { type: 'string', format: 'binary' } } } })
  @ApiOperation({ summary: 'Envia a foto do item (PNG, JPG ou WEBP; convertida para WebP)' })
  @ApiErrors(400, 413)
  setPhoto(
    @CurrentEstablishment() establishment: EstablishmentContext,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @UploadedFile() file: Express.Multer.File | undefined,
  ): Promise<ManagedMenuItemDto> {
    return this.menu.setPhoto(establishment.id, itemId, file);
  }

  @Patch('items/:itemId/availability')
  @RequireAccess(['menu.availability'])
  @ApiOperation({ summary: 'Marca o item como esgotado ou disponível (ficha 19); reflete no cliente em tempo real' })
  @ApiErrors(400)
  setAvailability(
    @CurrentEstablishment() establishment: EstablishmentContext,
    @CurrentAuth() auth: AuthContext,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @Body() dto: SetAvailabilityDto,
  ): Promise<ManagedMenuItemDto> {
    return this.menu.setAvailability(establishment.id, itemId, dto.available, auth.userId);
  }

  @Get('availability-history')
  @RequireAccess(['menu.availability'])
  @ApiOperation({ summary: 'Histórico de alterações de disponibilidade (quem e quando)' })
  history(@CurrentEstablishment() establishment: EstablishmentContext, @Query() query: PageQueryDto): Promise<AvailabilityHistoryPageDto> {
    return this.menu.availabilityHistory(establishment.id, query);
  }
}
