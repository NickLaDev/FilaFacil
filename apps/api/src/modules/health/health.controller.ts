import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { serviceUnavailable } from '../../common/http/app-error.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Public } from '../auth/auth.decorators.js';

@ApiTags('Saúde')
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @SkipThrottle()
  @Get()
  @ApiOperation({ summary: 'API e banco respondendo' })
  async check() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      throw serviceUnavailable('DATABASE_UNAVAILABLE', 'Banco de dados indisponível.');
    }
    return { status: 'ok' };
  }
}
