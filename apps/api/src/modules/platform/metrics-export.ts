import PDFDocument from 'pdfkit';
import type { PlatformMetricsDto } from '@filafacil/shared';
import { BRAND_NAME } from '../../common/brand.js';

const brl = (cents: number) => (cents / 100).toFixed(2).replace('.', ',');
const br = (iso: string) => iso.split('-').reverse().join('/');
const pct = (value: number | null) => (value === null ? '' : `${String(value).replace('.', ',')}%`);
const cell = (value: string | number) => {
  const text = String(value);
  const safe = /^[=+\-@]/.test(text) && typeof value === 'string' ? `'${text}` : text;
  return /[;"\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

/** CSV pt-BR (separador `;`, vírgula decimal, BOM): série diária, comparação e quebra por estabelecimento. */
export function metricsCsv(data: PlatformMetricsDto): string {
  const lines: (string | number)[][] = [
    ['Período', `${br(data.current.from)} a ${br(data.current.to)}`, 'Comparado com', `${br(data.previous.from)} a ${br(data.previous.to)}`],
    [],
    ['Indicador', 'Atual', 'Anterior', 'Variação'],
    ['Pedidos', data.current.totals.orders, data.previous.totals.orders, pct(data.change.orders)],
    ['GMV (R$)', brl(data.current.totals.gmvCents), brl(data.previous.totals.gmvCents), pct(data.change.gmvCents)],
    ['Usuários ativos', data.current.totals.activeUsers, data.previous.totals.activeUsers, pct(data.change.activeUsers)],
    [],
    ['Data', 'Pedidos', 'GMV (R$)', 'Usuários ativos'],
    ...data.current.series.map(point => [br(point.date), point.orders, brl(point.gmvCents), point.activeUsers]),
    [],
    ['Estabelecimento', 'Pedidos', 'GMV (R$)'],
    ...data.byEstablishment.map(row => [row.name, row.orders, brl(row.gmvCents)]),
    ['Total', data.current.totals.orders, brl(data.current.totals.gmvCents)],
  ];
  return `﻿${lines.map(line => line.map(cell).join(';')).join('\r\n')}\r\n`;
}

/** PDF A4 com os indicadores, a comparação e a quebra por estabelecimento. */
export function metricsPdf(data: PlatformMetricsDto): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: 'Métricas da plataforma', Author: BRAND_NAME } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const row = (cells: string[], widths: number[], bold = false) => {
      if (doc.y > 770) doc.addPage();
      const y = doc.y;
      let x = 40;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      cells.forEach((text, index) => {
        doc.text(text, x, y, { width: (widths[index] ?? 80) - 6, align: index === 0 ? 'left' : 'right', lineBreak: false, ellipsis: true });
        x += widths[index] ?? 80;
      });
      doc.y = y + 15;
    };
    doc.font('Helvetica-Bold').fontSize(16).text(`${BRAND_NAME} · Métricas da plataforma`, 40, 40);
    doc.font('Helvetica').fontSize(10).text(`De ${br(data.current.from)} a ${br(data.current.to)} · comparado com ${br(data.previous.from)} a ${br(data.previous.to)}`);
    doc.moveDown(1);
    const w4 = [160, 110, 110, 90];
    row(['Indicador', 'Atual', 'Anterior', 'Variação'], w4, true);
    row(['Pedidos', String(data.current.totals.orders), String(data.previous.totals.orders), pct(data.change.orders)], w4);
    row(['GMV', `R$ ${brl(data.current.totals.gmvCents)}`, `R$ ${brl(data.previous.totals.gmvCents)}`, pct(data.change.gmvCents)], w4);
    row(['Usuários ativos', String(data.current.totals.activeUsers), String(data.previous.totals.activeUsers), pct(data.change.activeUsers)], w4);
    doc.moveDown(1);
    doc.font('Helvetica-Bold').fontSize(11).text('Por dia', 40);
    doc.moveDown(0.3);
    row(['Data', 'Pedidos', 'GMV', 'Usuários'], w4, true);
    for (const point of data.current.series) row([br(point.date), String(point.orders), `R$ ${brl(point.gmvCents)}`, String(point.activeUsers)], w4);
    doc.moveDown(1);
    doc.font('Helvetica-Bold').fontSize(11).text('Por estabelecimento', 40);
    doc.moveDown(0.3);
    const w3 = [260, 100, 110];
    row(['Estabelecimento', 'Pedidos', 'GMV'], w3, true);
    for (const item of data.byEstablishment) row([item.name, String(item.orders), `R$ ${brl(item.gmvCents)}`], w3);
    row(['Total', String(data.current.totals.orders), `R$ ${brl(data.current.totals.gmvCents)}`], w3, true);
    doc.end();
  });
}
