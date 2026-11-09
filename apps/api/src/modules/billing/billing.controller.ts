import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { INVOICE_STATUSES, type BillingRunDto, type InvoiceDto, type InvoicesPage, type InvoiceStatus } from '@filafacil/shared';
import { ApiErrors } from '../../common/http/api-docs.js';
import { PageQueryDto } from '../../common/pagination/page-query.dto.js';
import { Trim } from '../../common/validation/transforms.js';
import { CurrentEstablishment, EstablishmentScoped, PlatformAdmin, RequireAccess } from '../access/access.decorators.js';
import type { EstablishmentContext } from '../access/access.types.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { BillingService } from './billing.service.js';

class InvoicesQueryDto extends PageQueryDto {
  @IsOptional()
  @IsIn(INVOICE_STATUSES)
  status?: InvoiceStatus;

  @IsOptional()
  @IsUUID()
  establishmentId?: string;

  @IsOptional()
  @Matches(/^\d{4}-\d{2}$/, { message: 'Use AAAA-MM.' })
  period?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  q?: string;
}

class PayInvoiceDto {
  @IsOptional()
  @Trim()
  @IsString()
  @MaxLength(120)
  note?: string;
}

@ApiTags('Admin · Pagamentos da plataforma')
@PlatformAdmin('platform.billing')
@Controller('admin')
export class AdminBillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('invoices')
  @ApiOperation({ summary: 'Faturas de todos os estabelecimentos: pago, pendente ou atrasado (ficha 38)' })
  list(@Query() query: InvoicesQueryDto): Promise<InvoicesPage> {
    return this.billing.list(query);
  }

  @Post('billing/run')
  @HttpCode(200)
  @ApiOperation({ summary: 'Executa a rotina de cobrança agora: gera as faturas do mês, marca atrasadas e avisa (idempotente)' })
  run(): Promise<BillingRunDto> {
    return this.billing.runCycle();
  }

  @Post('invoices/:id/pay')
  @HttpCode(200)
  @ApiOperation({ summary: 'Registra o pagamento da fatura' })
  @ApiErrors(404, 409)
  pay(@Param('id', ParseUUIDPipe) id: string, @CurrentAuth() auth: AuthContext, @Body() dto: PayInvoiceDto): Promise<InvoiceDto> {
    return this.billing.markPaid(id, auth.userId, dto.note);
  }

  @Post('invoices/:id/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'Cancela uma fatura pendente ou atrasada' })
  @ApiErrors(404, 409)
  cancel(@Param('id', ParseUUIDPipe) id: string): Promise<InvoiceDto> {
    return this.billing.cancel(id);
  }
}

@ApiTags('Faturas (gestor)')
@EstablishmentScoped()
@RequireAccess(['billing.view'])
@Controller('establishments/:establishmentId/invoices')
export class EstablishmentBillingController {
  constructor(private readonly billing: BillingService) {}

  @Get()
  @ApiOperation({ summary: 'Faturas do estabelecimento com status' })
  list(@CurrentEstablishment() establishment: EstablishmentContext): Promise<InvoiceDto[]> {
    return this.billing.listForEstablishment(establishment.id);
  }
}
