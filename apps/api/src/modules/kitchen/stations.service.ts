import { Injectable } from '@nestjs/common';
import type { KitchenStationDto } from '@filafacil/shared';
import { conflict, notFound } from '../../common/http/app-error.js';
import { PrismaService } from '../../database/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import { RealtimeService } from '../realtime/realtime.service.js';

const duplicate = () => conflict('STATION_NAME_TAKEN', 'Já existe uma estação com esse nome.');

/** Estações da cozinha (ficha 24), cadastradas pelo gestor. Itens sem estação pertencem à "Geral" implícita. */
@Injectable()
export class StationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(establishmentId: string): Promise<KitchenStationDto[]> {
    const rows = await this.prisma.kitchenStation.findMany({
      where: { establishmentId },
      orderBy: [{ position: 'asc' }, { name: 'asc' }],
      include: { _count: { select: { menuItems: { where: { deletedAt: null } } } } },
    });
    return rows.map(row => ({ id: row.id, name: row.name, position: row.position, itemCount: row._count.menuItems }));
  }

  async create(establishmentId: string, name: string): Promise<KitchenStationDto> {
    try {
      const last = await this.prisma.kitchenStation.aggregate({ where: { establishmentId }, _max: { position: true } });
      const row = await this.prisma.kitchenStation.create({ data: { establishmentId, name, position: (last._max.position ?? 0) + 1 } });
      this.realtime.menuUpdated(establishmentId);
      return { id: row.id, name: row.name, position: row.position, itemCount: 0 };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw duplicate();
      throw error;
    }
  }

  async update(establishmentId: string, stationId: string, data: { name?: string; position?: number }): Promise<KitchenStationDto> {
    await this.find(establishmentId, stationId);
    try {
      await this.prisma.kitchenStation.update({ where: { id: stationId }, data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw duplicate();
      throw error;
    }
    this.realtime.menuUpdated(establishmentId);
    const station = (await this.list(establishmentId)).find(item => item.id === stationId);
    if (!station) throw notFound('Estação não encontrada.');
    return station;
  }

  /** Excluir devolve os itens do cardápio à "Geral" (FK SET NULL); itens de pedidos antigos mantêm o histórico. */
  async remove(establishmentId: string, stationId: string): Promise<void> {
    await this.find(establishmentId, stationId);
    await this.prisma.kitchenStation.delete({ where: { id: stationId } });
    this.realtime.menuUpdated(establishmentId);
  }

  private async find(establishmentId: string, stationId: string) {
    const station = await this.prisma.kitchenStation.findFirst({ where: { id: stationId, establishmentId }, select: { id: true } });
    if (!station) throw notFound('Estação não encontrada.');
  }
}
