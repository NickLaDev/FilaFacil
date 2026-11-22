import { ALLERGENS, MENU_IMPORT_COLUMNS } from '@filafacil/shared';
import { MAX_PRICE_CENTS } from './dto/menu.dto.js';

// Ficha 54: leitura e validação da planilha (CSV) do cardápio. Funções puras: o serviço só grava o que passou aqui.

export type ImportColumn = (typeof MENU_IMPORT_COLUMNS)[number];
export const REQUIRED_COLUMNS: ImportColumn[] = ['nome', 'categoria', 'preco'];

export interface ParsedRow {
  line: number;
  raw: Record<string, string>;
  name: string;
  errors: string[];
  value?: {
    name: string;
    description: string;
    categoryName: string;
    priceCents: number;
    available: boolean;
    allergens: string[];
    stationName: string | null;
  };
}

/** Sem acento e em minúsculas, para comparar cabeçalhos, alérgenos e "sim/não". */
export const normalize = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();

/** Parser CSV (RFC 4180) com separador detectado no cabeçalho: `;` (Excel pt-BR), `,` ou tab. */
export function parseCsv(text: string): string[][] {
  const source = text.replace(/^\uFEFF/, '');
  const firstLine = source.split(/\r?\n/, 1)[0] ?? '';
  const separator = [';', '\t', ','].reduce((best, candidate) => (firstLine.split(candidate).length > firstLine.split(best).length ? candidate : best), ';');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (quoted) {
      if (char === '"' && source[i + 1] === '"') {
        field += '"';
        i++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field === '') quoted = true;
    else if (char === separator) {
      row.push(field);
      field = '';
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && source[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += char;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** "28,90", "R$ 1.234,50", "28.90" → centavos; null se não for um preço válido. */
export function parsePrice(value: string): number | null {
  let text = value.replace(/r\$/i, '').replace(/\s/g, '');
  if (!text) return null;
  if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return null;
  return Math.round(Number(text) * 100);
}

const YES = ['sim', 's', 'yes', 'y', 'true', '1', 'disponivel'];
const NO = ['nao', 'n', 'no', 'false', '0', 'esgotado', 'indisponivel'];

const ALLERGEN_LOOKUP = new Map<string, string>(ALLERGENS.flatMap(a => [[normalize(a.key), a.key] as const, [normalize(a.label), a.key] as const]));

/** Lê a planilha e valida linha a linha. `stations` = nomes normalizados → id. */
export function readMenuSheet(text: string, maxRows: number, stations: Map<string, string>): { rows: ParsedRow[]; headerError: string | null } {
  const table = parseCsv(text).filter(cells => cells.some(cell => cell.trim() !== ''));
  const [header, ...body] = table;
  if (!header) return { rows: [], headerError: 'A planilha está vazia. Use o modelo com o cabeçalho na primeira linha.' };
  const columns = header.map(cell => normalize(cell).replace(/[^a-z]/g, ''));
  const missing = REQUIRED_COLUMNS.filter(column => !columns.includes(column));
  if (missing.length) return { rows: [], headerError: `Faltam as colunas obrigatórias: ${missing.join(', ')}. Baixe o modelo para ver o formato.` };
  if (!body.length) return { rows: [], headerError: 'A planilha não tem itens abaixo do cabeçalho.' };
  if (body.length > maxRows) return { rows: [], headerError: `A planilha tem ${body.length} itens; o limite é ${maxRows} por importação. Divida em mais de um arquivo.` };

  const seen = new Map<string, number>();
  const rows = body.map((cells, index): ParsedRow => {
    const line = index + 2; // linha 1 = cabeçalho
    const raw: Record<string, string> = {};
    MENU_IMPORT_COLUMNS.forEach(column => {
      const at = columns.indexOf(column);
      raw[column] = at >= 0 ? (cells[at] ?? '').trim() : '';
    });
    const errors: string[] = [];
    const name = raw.nome ?? '';
    const categoryName = raw.categoria ?? '';
    const description = raw.descricao ?? '';
    if (!name) errors.push('Nome é obrigatório.');
    else if (name.length > 80) errors.push('Nome com mais de 80 caracteres.');
    if (!categoryName) errors.push('Categoria é obrigatória.');
    else if (categoryName.length > 40) errors.push('Categoria com mais de 40 caracteres.');
    if (description.length > 200) errors.push('Descrição com mais de 200 caracteres.');

    const priceCents = raw.preco ? parsePrice(raw.preco) : null;
    if (!raw.preco) errors.push('Preço é obrigatório.');
    else if (priceCents === null) errors.push(`Preço inválido "${raw.preco}" (use 28,90).`);
    else if (priceCents < 1 || priceCents > MAX_PRICE_CENTS) errors.push('Preço deve ficar entre R$ 0,01 e R$ 10.000,00.');

    let available = true;
    const availability = normalize(raw.disponivel ?? '');
    if (availability && YES.includes(availability)) available = true;
    else if (availability && NO.includes(availability)) available = false;
    else if (availability) errors.push(`Disponível deve ser "sim" ou "não" (veio "${raw.disponivel}").`);

    const allergens: string[] = [];
    for (const part of (raw.alergenos ?? '').split(/[,|/]/).map(normalize).filter(Boolean)) {
      const key = ALLERGEN_LOOKUP.get(part);
      if (!key) errors.push(`Alérgeno desconhecido "${part}".`);
      else if (!allergens.includes(key)) allergens.push(key);
    }

    let stationName: string | null = null;
    if (raw.estacao) {
      if (!stations.has(normalize(raw.estacao))) errors.push(`Estação "${raw.estacao}" não existe; cadastre-a antes ou deixe em branco.`);
      else stationName = normalize(raw.estacao);
    }

    if (name && categoryName) {
      const key = `${normalize(categoryName)}|${normalize(name)}`;
      const first = seen.get(key);
      if (first) errors.push(`Item repetido na planilha (mesmo nome e categoria da linha ${first}).`);
      else seen.set(key, line);
    }

    return errors.length || priceCents === null
      ? { line, raw, name, errors }
      : { line, raw, name, errors, value: { name, description, categoryName, priceCents, available, allergens, stationName } };
  });
  return { rows, headerError: null };
}

const csvCell = (value: string) => {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value; // não vira fórmula no Excel
  return /[;"\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export const toCsv = (rows: string[][]) => `\uFEFF${rows.map(row => row.map(csvCell).join(';')).join('\r\n')}\r\n`;

/** Modelo para download: cabeçalho e dois exemplos (separador `;`, abre direto no Excel em português). */
export const menuImportTemplate = () =>
  toCsv([
    [...MENU_IMPORT_COLUMNS],
    ['Chopp IPA 500ml', 'Lupulado e amargo na medida', 'Chopps', '24,90', 'sim', 'Glúten, Álcool', ''],
    ['Batata frita', 'Porção para 2 pessoas', 'Petiscos', '32,00', 'sim', '', ''],
  ]);

/** Planilha só com as linhas recusadas e a coluna "erro": o gestor corrige e reimporta o mesmo arquivo. */
export const errorSheet = (rows: ParsedRow[]) =>
  toCsv([[...MENU_IMPORT_COLUMNS, 'erro'], ...rows.map(row => [...MENU_IMPORT_COLUMNS.map(column => row.raw[column] ?? ''), row.errors.join(' ')])]);
