import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { CreatedPrinterDto, KitchenStationDto, PrinterDto, StaffAlertDto } from '@filafacil/shared';
import { ApiErrors } from '../../common/http/api-docs.js';
import { CurrentEstablishment, EstablishmentScoped, RequireAccess } from '../access/access.decorators.js';
import type { EstablishmentContext } from '../access/access.types.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { AlertsService } from './alerts.service.js';
import { CreatePrinterDto, CreateStationDto, UpdatePrinterDto, UpdateStationDto } from './dto/kitchen.dto.js';
import { PrintersService } from './printers.service.js';
import { StationsService } from './stations.service.js';

const uuid = (name: string) => Param(name, ParseUUIDPipe);

@ApiTags('Cozinha: estações, impressoras e alertas (equipe)')
@EstablishmentScoped()
@Controller('establishments/:establishmentId')
export class KitchenController {
  constructor(
    private readonly stations: StationsService,
    private readonly printers: PrintersService,
    private readonly alerts: AlertsService,
  ) {}

  @Get('kitchen-stations')
  @RequireAccess(['kitchen.manage', 'orders.manage'])
  @ApiOperation({ summary: 'Estações da cozinha (a "Geral" é implícita: itens sem estação)' })
  listStations(@CurrentEstablishment() establishment: EstablishmentContext): Promise<KitchenStationDto[]> {
    return this.stations.list(establishment.id);
  }

  @Post('kitchen-stations')
  @RequireAccess(['kitchen.manage'])
  @ApiOperation({ summary: 'Cadastra uma estação (ficha 24)' })
  @ApiErrors(400, 409)
  createStation(@CurrentEstablishment() establishment: EstablishmentContext, @Body() dto: CreateStationDto): Promise<KitchenStationDto> {
    return this.stations.create(establishment.id, dto.name);
  }

  @Patch('kitchen-stations/:stationId')
  @RequireAccess(['kitchen.manage'])
  @ApiErrors(400, 404, 409)
  updateStation(@CurrentEstablishment() establishment: EstablishmentContext, @uuid('stationId') stationId: string, @Body() dto: UpdateStationDto): Promise<KitchenStationDto> {
    return this.stations.update(establishment.id, stationId, dto);
  }

  @Delete('kitchen-stations/:stationId')
  @HttpCode(204)
  @RequireAccess(['kitchen.manage'])
  @ApiOperation({ summary: 'Exclui a estação; os itens voltam à "Geral"' })
  @ApiErrors(404)
  async removeStation(@CurrentEstablishment() establishment: EstablishmentContext, @uuid('stationId') stationId: string) {
    await this.stations.remove(establishment.id, stationId);
  }

  @Get('printers')
  @RequireAccess(['kitchen.manage', 'orders.manage'])
  @ApiOperation({ summary: 'Impressoras com estado online/offline (ficha 26)' })
  listPrinters(@CurrentEstablishment() establishment: EstablishmentContext): Promise<PrinterDto[]> {
    return this.printers.list(establishment.id);
  }

  @Post('printers')
  @RequireAccess(['kitchen.manage'])
  @ApiOperation({ summary: 'Cadastra impressora; a chave do dispositivo aparece só nesta resposta' })
  @ApiErrors(400, 409, 422)
  createPrinter(@CurrentEstablishment() establishment: EstablishmentContext, @Body() dto: CreatePrinterDto): Promise<CreatedPrinterDto> {
    return this.printers.create(establishment.id, dto);
  }

  @Patch('printers/:printerId')
  @RequireAccess(['kitchen.manage'])
  @ApiErrors(400, 404, 409, 422)
  updatePrinter(@CurrentEstablishment() establishment: EstablishmentContext, @uuid('printerId') printerId: string, @Body() dto: UpdatePrinterDto): Promise<PrinterDto> {
    return this.printers.update(establishment.id, printerId, dto);
  }

  @Delete('printers/:printerId')
  @HttpCode(204)
  @RequireAccess(['kitchen.manage'])
  @ApiErrors(404)
  async removePrinter(@CurrentEstablishment() establishment: EstablishmentContext, @uuid('printerId') printerId: string) {
    await this.printers.remove(establishment.id, printerId);
  }

  @Post('printers/:printerId/heartbeat')
  @HttpCode(200)
  @RequireAccess(['kitchen.manage'])
  @ApiOperation({ summary: 'SIMULAÇÃO: registra um heartbeat da impressora pelo painel (demonstração, sem hardware)' })
  @ApiErrors(404)
  simulateHeartbeat(@CurrentEstablishment() establishment: EstablishmentContext, @uuid('printerId') printerId: string): Promise<PrinterDto> {
    return this.printers.heartbeatSimulated(establishment.id, printerId);
  }

  @Get('alerts')
  @RequireAccess([])
  @ApiOperation({ summary: 'Alertas abertos visíveis ao usuário (impressora offline, estoque baixo)' })
  listAlerts(@CurrentEstablishment() establishment: EstablishmentContext, @CurrentAuth() auth: AuthContext): Promise<StaffAlertDto[]> {
    return this.alerts.list(establishment.id, auth.permissions);
  }

  @Post('alerts/:alertId/dismiss')
  @HttpCode(204)
  @RequireAccess([])
  @ApiErrors(404)
  async dismissAlert(@CurrentEstablishment() establishment: EstablishmentContext, @CurrentAuth() auth: AuthContext, @uuid('alertId') alertId: string) {
    await this.alerts.dismiss(establishment.id, alertId, auth.permissions);
  }
}
