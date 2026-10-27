import { Controller, Headers, HttpCode, Post } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { SkipCsrf } from '../../common/security/csrf.guard.js';
import { Public } from '../auth/auth.decorators.js';
import { PrintersService } from './printers.service.js';

/** Rota do dispositivo da impressora: sem sessão nem cookie; autentica pela chave própria (`X-Printer-Key`). */
@ApiTags('Impressoras (dispositivo)')
@Controller('printers')
export class PrinterDeviceController {
  constructor(private readonly printers: PrintersService) {}

  @Post('heartbeat')
  @Public()
  @SkipCsrf()
  @HttpCode(204)
  @Throttle({ default: { limit: 120, ttl: 60_000 } })
  @ApiOperation({ summary: 'Heartbeat da impressora (a cada ≤ 30 s). 60 s sem sinal = offline' })
  async heartbeat(@Headers('x-printer-key') key: string | undefined): Promise<void> {
    await this.printers.heartbeatByKey(key);
  }
}
