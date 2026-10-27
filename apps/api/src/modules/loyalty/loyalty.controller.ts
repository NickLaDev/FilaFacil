import { Controller, Get, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import type { LoyaltyDto } from '@filafacil/shared';
import { ApiErrors } from '../../common/http/api-docs.js';
import { ToNumber } from '../../common/validation/transforms.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { LoyaltyService } from './loyalty.service.js';

class LoyaltyQueryDto {
  @IsOptional()
  @ToNumber()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

@ApiTags('FilaZero Club (cliente)')
@ApiCookieAuth()
@ApiErrors(401)
@Controller('me/loyalty')
export class LoyaltyController {
  constructor(private readonly loyalty: LoyaltyService) {}

  @Get()
  @ApiOperation({ summary: 'Saldo, regras e extrato (razão) de pontos do FilaZero Club (ficha 14)' })
  overview(@CurrentAuth() auth: AuthContext, @Query() query: LoyaltyQueryDto): Promise<LoyaltyDto> {
    return this.loyalty.overview(auth.userId, query.limit);
  }
}
