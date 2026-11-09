import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsISO8601, IsOptional, IsUUID, Matches, Max, Min } from 'class-validator';
import { BOOKING_MAX_PARTY, BOOKING_STATUSES, type BookingDto, type BookingSlotsDto, type BookingStatus } from '@filafacil/shared';
import { ApiErrors } from '../../common/http/api-docs.js';
import { ToBoolean, ToNumber } from '../../common/validation/transforms.js';
import { CurrentEstablishment, EstablishmentScoped, RequireAccess } from '../access/access.decorators.js';
import type { EstablishmentContext } from '../access/access.types.js';
import { CurrentAuth, Public } from '../auth/auth.decorators.js';
import type { AuthContext } from '../auth/auth.types.js';
import { BookingsService } from './bookings.service.js';

class CreateBookingDto {
  @IsUUID()
  establishmentId!: string;

  @IsISO8601({ strict: true })
  startsAt!: string;

  @IsInt()
  @Min(1)
  @Max(BOOKING_MAX_PARTY)
  partySize!: number;
}

class SlotsQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'Use a data no formato AAAA-MM-DD.' })
  date!: string;

  @ToNumber()
  @IsInt()
  @Min(1)
  @Max(BOOKING_MAX_PARTY)
  partySize!: number;
}

class StaffBookingsQueryDto {
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  date?: string;

  @IsOptional()
  @IsIn(BOOKING_STATUSES)
  status?: BookingStatus;

  @IsOptional()
  @ToBoolean()
  @IsBoolean()
  includePast?: boolean;
}

@ApiTags('Reservas de mesa (cliente)')
@Controller()
export class BookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Public()
  @Get('restaurants/:id/booking-slots')
  @ApiOperation({ summary: 'Horários do dia com disponibilidade para o tamanho do grupo (ficha 30)' })
  @ApiErrors(400, 404, 422)
  slots(@Param('id', ParseUUIDPipe) id: string, @Query() query: SlotsQueryDto): Promise<BookingSlotsDto> {
    return this.bookings.slots(id, query.date, query.partySize);
  }

  @ApiCookieAuth()
  @Post('bookings')
  @ApiOperation({ summary: 'Reserva uma mesa: confirmada ou recusada na hora, conforme a disponibilidade (ficha 30)' })
  @ApiErrors(400, 401, 404, 409, 422)
  create(@CurrentAuth() auth: AuthContext, @Body() dto: CreateBookingDto): Promise<BookingDto> {
    return this.bookings.create(auth.userId, dto);
  }

  @ApiCookieAuth()
  @Get('me/bookings')
  @ApiOperation({ summary: 'Reservas do cliente (perfil)' })
  mine(@CurrentAuth() auth: AuthContext): Promise<BookingDto[]> {
    return this.bookings.listMine(auth.userId);
  }

  @ApiCookieAuth()
  @Post('bookings/:bookingId/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'O cliente cancela uma reserva confirmada futura' })
  @ApiErrors(401, 404, 409)
  cancel(@CurrentAuth() auth: AuthContext, @Param('bookingId', ParseUUIDPipe) bookingId: string): Promise<BookingDto> {
    return this.bookings.cancelMine(auth.userId, bookingId);
  }
}

@ApiTags('Reservas de mesa (gestor)')
@EstablishmentScoped()
@RequireAccess(['reservations.manage'])
@Controller('establishments/:establishmentId/bookings')
export class StaffBookingsController {
  constructor(private readonly bookings: BookingsService) {}

  @Get()
  @ApiOperation({ summary: 'Reservas do estabelecimento (a partir de hoje, ou de uma data), com status' })
  list(@CurrentEstablishment() establishment: EstablishmentContext, @Query() query: StaffBookingsQueryDto): Promise<BookingDto[]> {
    return this.bookings.listForStaff(establishment.id, query);
  }

  @Post(':bookingId/cancel')
  @HttpCode(200)
  @ApiOperation({ summary: 'A casa cancela uma reserva confirmada; o cliente é avisado' })
  @ApiErrors(404, 409)
  cancel(@CurrentEstablishment() establishment: EstablishmentContext, @CurrentAuth() auth: AuthContext, @Param('bookingId', ParseUUIDPipe) bookingId: string): Promise<BookingDto> {
    return this.bookings.cancelForStaff(establishment.id, bookingId, auth.userId);
  }

  @Post(':bookingId/seat')
  @HttpCode(200)
  @ApiOperation({ summary: 'Marca a reserva como atendida (cliente chegou)' })
  @ApiErrors(404, 409)
  seat(@CurrentEstablishment() establishment: EstablishmentContext, @Param('bookingId', ParseUUIDPipe) bookingId: string): Promise<BookingDto> {
    return this.bookings.seat(establishment.id, bookingId);
  }
}
