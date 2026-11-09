import { Controller, Get, Header, Query, Res } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsIn, IsOptional, Matches } from 'class-validator';
import type { Response } from 'express';
import type { CostReportDto } from '@filafacil/shared';
import { ApiErrors } from '../../common/http/api-docs.js';
import { CurrentEstablishment, EstablishmentScoped, RequireAccess } from '../access/access.decorators.js';
import type { EstablishmentContext } from '../access/access.types.js';
import { costReportCsv } from './cost-report.js';
import { costReportPdf } from './cost-report-pdf.js';
import { ReportsService } from './reports.service.js';

class CostReportQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use a data no formato AAAA-MM-DD.' })
  from!: string;

  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use a data no formato AAAA-MM-DD.' })
  to!: string;
}

class CostReportExportQueryDto extends CostReportQueryDto {
  @IsOptional()
  @IsIn(['csv', 'pdf'])
  format?: 'csv' | 'pdf';
}

@ApiTags('Relatórios (gestor)')
@EstablishmentScoped()
@RequireAccess(['reports.view'], 'recipes')
@Controller('establishments/:establishmentId/reports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('cost')
  @ApiOperation({ summary: 'Custo e margem dos pratos vendidos no período, por item e por categoria (ficha 57)' })
  @ApiErrors(400, 422)
  cost(@CurrentEstablishment() establishment: EstablishmentContext, @Query() query: CostReportQueryDto): Promise<CostReportDto> {
    return this.reports.costReport(establishment.id, query.from, query.to);
  }

  @Get('cost/export')
  @Header('Cache-Control', 'no-store')
  @ApiOperation({ summary: 'Exporta o relatório de custo em CSV ou PDF' })
  @ApiErrors(400, 422)
  async export(@CurrentEstablishment() establishment: EstablishmentContext, @Query() query: CostReportExportQueryDto, @Res() response: Response): Promise<void> {
    const report = await this.reports.costReport(establishment.id, query.from, query.to);
    const name = `custo-${query.from}_a_${query.to}`;
    if (query.format === 'pdf') {
      const pdf = await costReportPdf(report, establishment.name);
      response.type('application/pdf').attachment(`${name}.pdf`).send(pdf);
      return;
    }
    response.type('text/csv; charset=utf-8').attachment(`${name}.csv`).send(costReportCsv(report));
  }
}
