import { lockResource } from '../../database/advisory-lock.js';
import type { PrismaTx } from '../../database/prisma.service.js';

/** Ids da mesa e das demais mesas do grupo mesclado a que ela pertence (ficha 47). Mesa de outro estabelecimento = vazio. */
export async function tableScope(tx: PrismaTx, tableId: string, establishmentId?: string): Promise<string[]> {
  const table = await tx.diningTable.findFirst({
    where: { id: tableId, ...(establishmentId ? { establishmentId } : {}) },
    select: { id: true, groupId: true },
  });
  if (!table) return [];
  if (!table.groupId) return [table.id];
  const members = await tx.diningTable.findMany({ where: { groupId: table.groupId }, select: { id: true } });
  return members.map(member => member.id);
}

/**
 * Pagamento aprovado de um pedido com mesa: a mesa (ou o grupo) passa a ocupada se ainda estava livre.
 * Roda dentro da transação do pagamento; `at` é o instante da aprovação e inicia a conta da mesa.
 */
export async function occupyForPayment(tx: PrismaTx, tableId: string | null, establishmentId: string, at: Date): Promise<void> {
  if (!tableId) return;
  await lockResource(tx, `tables:${establishmentId}`); // mesmo lock do mapa: mescla/ocupação não correm junto
  const ids = await tableScope(tx, tableId);
  if (!ids.length) return;
  await tx.diningTable.updateMany({ where: { id: { in: ids }, occupancy: 'free' }, data: { occupancy: 'occupied', occupiedSince: at } });
  await tx.tableReservation.updateMany({ where: { tableId: { in: ids }, closedAt: null }, data: { closedAt: at } });
}

/** Remove grupos que ficaram com menos de duas mesas (ex.: mesa excluída da planta). */
export async function dissolveSmallGroups(tx: PrismaTx, establishmentId: string): Promise<void> {
  const groups = await tx.tableGroup.findMany({ where: { establishmentId }, select: { id: true, _count: { select: { tables: true } } } });
  const small = groups.filter(group => group._count.tables < 2).map(group => group.id);
  if (small.length) await tx.tableGroup.deleteMany({ where: { id: { in: small } } });
}
