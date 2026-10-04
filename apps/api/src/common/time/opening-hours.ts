import type { OpeningHourDto } from '@filafacil/shared';

export interface OpeningRange {
  weekday: number;
  /** Minutos desde a meia-noite (fuso do estabelecimento). */
  opensAt: number;
  closesAt: number;
}

export interface LocalClock {
  weekday: number;
  minutes: number;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const formatters = new Map<string, Intl.DateTimeFormat>();

/** Dia da semana e minuto do dia no fuso informado (nunca no fuso do servidor). */
export function localClock(now: Date, timeZone: string): LocalClock {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
    formatters.set(timeZone, formatter);
  }
  const parts = Object.fromEntries(formatter.formatToParts(now).map(part => [part.type, part.value]));
  return { weekday: WEEKDAYS.indexOf(parts.weekday ?? ''), minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

export const isValidTimeZone = (timeZone: string) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
};

const crossesMidnight = (range: OpeningRange) => range.closesAt <= range.opensAt;
const previousDay = (weekday: number) => (weekday + 6) % 7;

/** Faixa ativa agora: inclui a de ontem que atravessa a meia-noite (ex.: 17:00–02:00). */
export function activeRange(ranges: OpeningRange[], clock: LocalClock): OpeningRange | null {
  return (
    ranges.find(range => {
      if (range.weekday === clock.weekday) {
        return clock.minutes >= range.opensAt && (crossesMidnight(range) || clock.minutes < range.closesAt);
      }
      return range.weekday === previousDay(clock.weekday) && crossesMidnight(range) && clock.minutes < range.closesAt;
    }) ?? null
  );
}

export const formatMinutes = (minutes: number) =>
  `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;

export const parseTime = (value: string) => {
  const [hours, minutes] = value.split(':').map(Number);
  return (hours ?? 0) * 60 + (minutes ?? 0);
};

/** Texto do horário do dia exibido ao cliente (ficha 12). */
export function hoursLabel(ranges: OpeningRange[], clock: LocalClock): string {
  const active = activeRange(ranges, clock);
  if (active) return `Hoje: ${formatMinutes(active.opensAt)}–${formatMinutes(active.closesAt)}`;
  const laterToday = ranges
    .filter(range => range.weekday === clock.weekday && range.opensAt > clock.minutes)
    .sort((a, b) => a.opensAt - b.opensAt)[0];
  if (laterToday) return `Abre às ${formatMinutes(laterToday.opensAt)}`;
  return ranges.some(range => range.weekday === clock.weekday) ? 'Fechado agora' : 'Fechado hoje';
}

export const toOpeningHourDto = ({ weekday, opensAt, closesAt }: OpeningRange): OpeningHourDto => ({
  weekday,
  opensAt: formatMinutes(opensAt),
  closesAt: formatMinutes(closesAt),
});
