import { Injectable } from '@nestjs/common';
import type { MenuImportResultDto, MenuImportRowResult } from '@filafacil/shared';
import { unprocessable } from '../../common/http/app-error.js';
import { lockResource } from '../../database/advisory-lock.js';
import { PrismaService } from '../../database/prisma.service.js';
import { AuditService } from '../audit/audit.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { errorSheet, normalize, readMenuSheet } from './menu-import.js';

/**
 * Ficha 54: importa o cardápio em massa a partir de uma planilha CSV. Cada linha válida cria um item novo ou atualiza
 * o item ativo de mesmo nome na mesma categoria (reimportar a planilha corrigida não duplica nada). Linhas com erro
 * não impedem as demais e voltam numa planilha própria para corrigir. `dryRun` só valida.
 */
@Injectable()
export class MenuImportService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly audit: AuditService,
    private readonly realtime: RealtimeService,
  ) {}

  async import(establishmentId: string, text: string, dryRun: boolean): Promise<MenuImportResultDto> {
    const started = Date.now();
    await this.settings.assertEnabled('features.menuImport', 'A importação de cardápio está desativada no momento.');
    const maxRows = await this.settings.get<number>('menuImport.maxRows');
    const stationRows = await this.prisma.kitchenStation.findMany({ where: { establishmentId }, select: { id: true, name: true } });
    const stations = new Map(stationRows.map(station => [normalize(station.name), station.id]));
    const { rows, headerError } = readMenuSheet(text, maxRows, stations);
    if (headerError) throw unprocessable('INVALID_SPREADSHEET', headerError);

    const results: MenuImportRowResult[] = rows.map(row => ({ line: row.line, name: row.name, status: row.value ? 'valid' : 'error', errors: row.errors }));
    let created = 0;
    let updated = 0;
    const valid = rows.filter(row => row.value);

    if (!dryRun && valid.length) {
      await this.prisma.$transaction(
        async tx => {
          await lockResource(tx, `menu-import:${establishmentId}`);
          const categories = await tx.menuCategory.findMany({ where: { establishmentId }, select: { id: true, name: true, position: true } });
          const categoryIds = new Map(categories.map(category => [normalize(category.name), category.id]));
          let lastCategory = Math.max(0, ...categories.map(category => category.position));
          const items = await tx.menuItem.findMany({ where: { establishmentId, deletedAt: null }, select: { id: true, name: true, categoryId: true, position: true } });
          const existing = new Map(items.map(item => [`${item.categoryId}|${normalize(item.name)}`, item.id]));
          const lastPosition = new Map<string, number>();
          for (const item of items) lastPosition.set(item.categoryId, Math.max(lastPosition.get(item.categoryId) ?? 0, item.position));

          for (const row of valid) {
            const value = row.value!;
            let categoryId = categoryIds.get(normalize(value.categoryName));
            if (!categoryId) {
              lastCategory += 1;
              categoryId = (await tx.menuCategory.create({ data: { establishmentId, name: value.categoryName, position: lastCategory }, select: { id: true } })).id;
              categoryIds.set(normalize(value.categoryName), categoryId);
            }
            const data = {
              name: value.name,
              description: value.description,
              priceCents: value.priceCents,
              available: value.available,
              allergens: value.allergens,
              stationId: value.stationName ? (stations.get(value.stationName) ?? null) : null,
            };
            const result = results.find(r => r.line === row.line)!;
            const currentId = existing.get(`${categoryId}|${normalize(value.name)}`);
            if (currentId) {
              await tx.menuItem.update({ where: { id: currentId }, data });
              result.status = 'updated';
              updated++;
            } else {
              const position = (lastPosition.get(categoryId) ?? 0) + 1;
              lastPosition.set(categoryId, position);
              const item = await tx.menuItem.create({ data: { ...data, establishmentId, categoryId, position }, select: { id: true } });
              existing.set(`${categoryId}|${normalize(value.name)}`, item.id);
              result.status = 'created';
              created++;
            }
          }
          await this.audit.record(
            {
              action: 'menu.imported',
              targetType: 'establishment',
              targetId: establishmentId,
              summary: `Cardápio importado: ${created} criado(s), ${updated} atualizado(s), ${rows.length - valid.length} com erro`,
              details: { total: rows.length, created, updated, failed: rows.length - valid.length },
            },
            tx,
          );
        },
        { timeout: 60_000 },
      );
      this.realtime.menuUpdated(establishmentId);
    }

    const failedRows = rows.filter(row => !row.value);
    return {
      dryRun,
      total: rows.length,
      created,
      updated,
      failed: failedRows.length,
      rows: results,
      errorCsv: failedRows.length ? errorSheet(failedRows) : null,
      durationMs: Date.now() - started,
    };
  }
}
