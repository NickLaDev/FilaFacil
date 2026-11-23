const pad = (n: number) => String(n).padStart(2, '0');

/** AAAA-MM-DD no fuso do navegador (filtros de período). */
export const isoDay = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const addDays = (iso: string, days: number) => {
  const [y, m, d] = iso.split('-').map(Number) as [number, number, number];
  return isoDay(new Date(y, m - 1, d + days));
};

/** "2026-11-22" → "22/11". */
export const shortDay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
export const brDay = (iso: string) => iso.split('-').reverse().join('/');
