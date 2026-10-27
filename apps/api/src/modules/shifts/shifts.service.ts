import { Injectable } from '@nestjs/common';
import type { Page, ShiftDto, ShiftHistoryDto } from '@filafacil/shared';
import { conflict, notFound } from '../../common/http/app-error.js';
import { pageArgs, toPage, type PageQueryDto } from '../../common/pagination/page-query.dto.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { ORDER_INCLUDE, toStaffOrderDto } from '../orders/order.mapper.js';
import { RealtimeService } from '../realtime/realtime.service.js';

const toDto = (shift: { id: string; openedAt: Date; closedAt: Date | null }): ShiftDto => ({
  id: shift.id,
  openedAt: shift.openedAt.toISOString(),
  closedAt: shift.closedAt?.toISOString() ?? null,
});

/** Turno do estabelecimento (ficha 25): o gestor abre e fecha; o histórico é do período aberto. */
@Injectable()
export class ShiftsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async current(establishmentId: string): Promise<ShiftDto | null> {
    const shift = await this.prisma.shift.findFirst({ where: { establishmentId, closedAt: null } });
    return shift ? toDto(shift) : null;
  }

  async open(establishmentId: string, actorId: string): Promise<ShiftDto> {
    try {
      const shift = await this.prisma.shift.create({ data: { establishmentId, openedById: actorId } });
      this.realtime.shiftUpdated(establishmentId);
      return toDto(shift);
    } catch (error) {
      // Índice parcial: um turno aberto por estabelecimento (cobre duas aberturas simultâneas).
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('SHIFT_ALREADY_OPEN', 'Já existe um turno aberto.');
      }
      throw error;
    }
  }

  async close(establishmentId: string, actorId: string): Promise<ShiftHistoryDto> {
    const open = await this.prisma.shift.findFirst({ where: { establishmentId, closedAt: null } });
    if (!open) throw conflict('NO_OPEN_SHIFT', 'Não há turno aberto.');
    const closed = await this.prisma.shift.updateMany({ where: { id: open.id, closedAt: null }, data: { closedAt: new Date(), closedById: actorId } });
    if (closed.count === 0) throw conflict('NO_OPEN_SHIFT', 'Não há turno aberto.');
    this.realtime.shiftUpdated(establishmentId);
    return this.history(establishmentId, open.id);
  }

  async list(establishmentId: string, query: PageQueryDto): Promise<Page<ShiftDto>> {
    const where = { establishmentId };
    const [rows, total] = await Promise.all([
      this.prisma.shift.findMany({ where, orderBy: { openedAt: 'desc' }, ...pageArgs(query) }),
      this.prisma.shift.count({ where }),
    ]);
    return toPage(rows.map(toDto), total, query);
  }

  /** Pedidos entregues e cancelados dentro do período do turno (aberto: até agora) e os totais. */
  async history(establishmentId: string, shiftId: string): Promise<ShiftHistoryDto> {
    const shift = await this.prisma.shift.findFirst({ where: { id: shiftId, establishmentId } });
    if (!shift) throw notFound('Turno não encontrado.');
    const period = { gte: shift.openedAt, lte: shift.closedAt ?? new Date() };
    const rows = await this.prisma.order.findMany({
      where: { establishmentId, OR: [{ status: 'delivered', deliveredAt: period }, { status: 'cancelled', cancelledAt: period }] },
      include: { ...ORDER_INCLUDE, user: { select: { name: true } } },
      orderBy: { updatedAt: 'desc' },
    });
    const delivered = rows.filter(order => order.status === 'delivered');
    const cancelled = rows.filter(order => order.status === 'cancelled');
    return {
      shift: toDto(shift),
      totals: {
        deliveredCount: delivered.length,
        cancelledCount: cancelled.length,
        deliveredCents: delivered.reduce((sum, order) => sum + order.totalCents, 0),
        refundedCents: cancelled.filter(order => order.paidAt).reduce((sum, order) => sum + order.totalCents, 0),
      },
      orders: rows.map(order => toStaffOrderDto(order)),
    };
  }
}
