import PDFDocument from 'pdfkit';
import type { CostReportDto } from '@filafacil/shared';
import { BRAND_NAME } from '../../common/brand.js';

const brl = (cents: number) => `R$ ${(cents / 100).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.')}`;
const pct = (value: number | null) => (value === null ? '—' : `${String(value).replace('.', ',')}%`);
const date = (iso: string) => iso.split('-').reverse().join('/');

/** PDF A4 do relatório de custo e margem (fonte padrão Helvetica: cobre o português). */
export function costReportPdf(report: CostReportDto, establishmentName: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, info: { Title: `Custo por período — ${establishmentName}`, Author: BRAND_NAME } });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const columns = [
      { label: 'Item', width: 170, align: 'left' as const },
      { label: 'Qtd', width: 40, align: 'right' as const },
      { label: 'Receita', width: 85, align: 'right' as const },
      { label: 'Custo', width: 85, align: 'right' as const },
      { label: 'Margem', width: 85, align: 'right' as const },
      { label: '%', width: 50, align: 'right' as const },
    ];
    const row = (cells: string[], bold = false) => {
      if (doc.y > 770) doc.addPage();
      const y = doc.y;
      let x = 40;
      doc.font(bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(9);
      cells.forEach((cell, index) => {
        const column = columns[index] as (typeof columns)[number];
        doc.text(cell, x, y, { width: column.width - 6, align: column.align, lineBreak: false, ellipsis: true });
        x += column.width;
      });
      doc.y = y + 15;
    };

    doc.font('Helvetica-Bold').fontSize(16).text('Custo por período', 40, 40);
    doc.font('Helvetica').fontSize(10).text(`${establishmentName} — de ${date(report.from)} a ${date(report.to)}`);
    doc.moveDown(1);

    row(columns.map(c => c.label), true);
    doc.moveTo(40, doc.y - 3).lineTo(515, doc.y - 3).stroke();
    let category = '';
    for (const item of report.rows) {
      if (item.category !== category) {
        category = item.category;
        doc.font('Helvetica-Bold').fontSize(9).fillColor('#a03020').text(category, 40, doc.y + 3);
        doc.fillColor('black');
        doc.y += 3;
      }
      row([item.name, String(item.quantity), brl(item.revenueCents), item.costCents === null ? 'sem ficha' : brl(item.costCents), item.marginCents === null ? '—' : brl(item.marginCents), pct(item.marginPercent)]);
    }

    doc.moveDown(1);
    doc.font('Helvetica-Bold').fontSize(11).text('Margem por categoria', 40, doc.y);
    doc.moveDown(0.5);
    for (const c of report.categories) row([c.category, String(c.quantity), brl(c.revenueCents), brl(c.costCents), brl(c.marginCents), pct(c.marginPercent)]);
    doc.moveTo(40, doc.y).lineTo(515, doc.y).stroke();
    doc.y += 4;
    row(['Total (itens com ficha)', String(report.totals.quantity), brl(report.totals.coveredRevenueCents), brl(report.totals.costCents), brl(report.totals.marginCents), pct(report.totals.marginPercent)], true);
    if (report.itemsWithoutSheet > 0) {
      doc.moveDown(0.5).font('Helvetica-Oblique').fontSize(8).text(`${report.itemsWithoutSheet} item(ns) vendido(s) sem ficha técnica ficaram fora do custo e da margem.`, 40);
    }
    doc.end();
  });
}
