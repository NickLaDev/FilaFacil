import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post, Put } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Length, Matches, Max, Min } from 'class-validator';
import type { SavedPaymentMethodDto } from '@filafacil/shared';
import { ApiErrors } from '../../common/http/api-docs.js';
import { Trim } from '../../common/validation/transforms.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { PaymentMethodsService } from './payment-methods.service.js';

class SavePaymentMethodDto {
  @IsIn(['credit', 'debit'])
  kind!: 'credit' | 'debit';

  /** Só para tokenização no cofre do provedor; nunca é guardado nem registrado em log. */
  @IsString()
  @Matches(/^[\d\s-]{13,23}$/, { message: 'Número de cartão inválido.' })
  number!: string;

  @Trim()
  @IsString()
  @Length(2, 60)
  holderName!: string;

  @IsInt()
  @Min(1)
  @Max(12)
  expMonth!: number;

  @IsInt()
  @Min(2000)
  @Max(2100)
  expYear!: number;

  @IsString()
  @Matches(/^\d{3,4}$/, { message: 'CVV inválido.' })
  cvv!: string;

  @IsOptional()
  @IsBoolean()
  makeDefault?: boolean;
}

@ApiTags('Métodos de pagamento (cliente)')
@ApiCookieAuth()
@ApiErrors(401)
@Controller('me/payment-methods')
export class PaymentMethodsController {
  constructor(private readonly methods: PaymentMethodsService) {}

  @Get()
  @ApiOperation({ summary: 'Cartões salvos (o padrão vem primeiro)' })
  list(@CurrentAuth() auth: AuthContext): Promise<SavedPaymentMethodDto[]> {
    return this.methods.list(auth.userId);
  }

  @Post()
  @ApiOperation({ summary: 'Salva um cartão: tokeniza no cofre do provedor e guarda só bandeira, final e validade (ficha 49)' })
  @ApiErrors(400, 409, 422, 503)
  create(@CurrentAuth() auth: AuthContext, @Body() dto: SavePaymentMethodDto): Promise<SavedPaymentMethodDto> {
    return this.methods.create(auth.userId, dto);
  }

  @Put(':id/default')
  @ApiOperation({ summary: 'Define o cartão padrão' })
  @ApiErrors(404)
  setDefault(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<SavedPaymentMethodDto> {
    return this.methods.setDefault(auth.userId, id);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Remove um cartão salvo' })
  @ApiErrors(404)
  async remove(@CurrentAuth() auth: AuthContext, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.methods.remove(auth.userId, id);
  }
}
