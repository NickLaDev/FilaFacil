import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { ApiErrors } from '../../common/http/api-docs.js';
import { CurrentAuth } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { MyReservationResponseDto, MyReservationsResponseDto, MyReservationStateResponseDto, ReserveDto } from './dto/waitlist.dto.js';
import { WaitlistService } from './waitlist.service.js';

/** Ficha 12: botão "Reservar" da página do restaurante. A reserva é uma entrada na fila de espera do restaurante. */
@ApiTags('Reserva do cliente')
@ApiCookieAuth()
@ApiErrors(401)
@Controller('restaurants/:restaurantId/reservation')
export class ReservationsController {
  constructor(private readonly waitlist: WaitlistService) {}

  @Get()
  @ApiOperation({ summary: 'Reserva atual do cliente neste restaurante (posição e estimativa)' })
  mine(@CurrentAuth() auth: AuthContext, @Param('restaurantId', ParseUUIDPipe) restaurantId: string): Promise<MyReservationStateResponseDto> {
    return this.waitlist.myReservation(restaurantId, auth.userId);
  }

  @Post()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @ApiOperation({ summary: 'Reserva: entra na fila de espera do restaurante aberto (uma por cliente)' })
  @ApiErrors(400, 403, 404, 409, 429)
  reserve(
    @CurrentAuth() auth: AuthContext,
    @Param('restaurantId', ParseUUIDPipe) restaurantId: string,
    @Body() dto: ReserveDto,
  ): Promise<MyReservationResponseDto> {
    return this.waitlist.reserve(restaurantId, auth.userId, dto);
  }

  @Delete()
  @HttpCode(204)
  @ApiOperation({ summary: 'Cancela a reserva do cliente' })
  @ApiErrors(404)
  async cancel(@CurrentAuth() auth: AuthContext, @Param('restaurantId', ParseUUIDPipe) restaurantId: string) {
    await this.waitlist.cancelReservation(restaurantId, auth.userId);
  }
}

@ApiTags('Reserva do cliente')
@ApiCookieAuth()
@ApiErrors(401)
@Controller('me/reservations')
export class MyReservationsController {
  constructor(private readonly waitlist: WaitlistService) {}

  @Get()
  @ApiOperation({ summary: 'Reservas ativas do cliente em todos os restaurantes (ficha 13)' })
  list(@CurrentAuth() auth: AuthContext): Promise<MyReservationsResponseDto> {
    return this.waitlist.myReservations(auth.userId);
  }
}
