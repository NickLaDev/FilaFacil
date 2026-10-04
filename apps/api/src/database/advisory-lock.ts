import type { PrismaTx } from './prisma.service.js';

/**
 * Serializa operações concorrentes sobre o mesmo recurso (ex.: fila de um estabelecimento)
 * até o fim da transação corrente. O lock é liberado no commit/rollback.
 */
export async function lockResource(tx: PrismaTx, resource: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${resource}, 0))`;
}
