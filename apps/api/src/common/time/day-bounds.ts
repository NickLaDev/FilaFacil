/** Deslocamento (min) do fuso IANA em relação ao UTC no instante dado (positivo = à frente do UTC). */
function offsetMinutes(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(instant);
  const get = (type: string) => Number(parts.find(part => part.type === type)?.value);
  const asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  return Math.round((asUtc - Math.floor(instant.getTime() / 1000) * 1000) / 60_000);
}

/** Instante UTC da meia-noite local (fuso IANA) do dia `y-m-d`. */
function localMidnight(y: number, m: number, d: number, timeZone: string): Date {
  let guess = Date.UTC(y, m - 1, d, 0, 0, 0);
  for (let i = 0; i < 3; i++) guess = Date.UTC(y, m - 1, d, 0, 0, 0) - offsetMinutes(new Date(guess), timeZone) * 60_000;
  return new Date(guess);
}

/** Início (inclusive) e fim (exclusivo) do dia civil de `now` no fuso do estabelecimento. */
export function dayBounds(now: Date, timeZone: string): { start: Date; end: Date } {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now).split('-').map(Number) as [number, number, number];
  const next = new Date(Date.UTC(y, m - 1, d + 1));
  return { start: localMidnight(y, m, d, timeZone), end: localMidnight(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate(), timeZone) };
}
