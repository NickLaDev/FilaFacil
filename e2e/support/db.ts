import { Client } from 'pg';
import { E2E_DB, e2eDatabaseUrl } from './env';

/**
 * Consulta SOMENTE LEITURA ao banco `filafacil_e2e` (transação read-only; falha se o banco conectado não for o do E2E).
 * Usada para provar persistência (pedido, pagamento, e-mail verificado, conta anonimizada...).
 */
export async function dbQuery<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
  const client = new Client({ connectionString: e2eDatabaseUrl(), options: '-c default_transaction_read_only=on' });
  await client.connect();
  try {
    const { rows: who } = await client.query('select current_database() as db');
    if (who[0].db !== E2E_DB) throw new Error(`GUARD: banco "${who[0].db}" não é ${E2E_DB}`);
    const { rows } = await client.query(sql, params);
    return rows as T[];
  } finally {
    await client.end();
  }
}

export const dbOne = async <T = Record<string, unknown>>(sql: string, params: unknown[] = []) => (await dbQuery<T>(sql, params))[0];
