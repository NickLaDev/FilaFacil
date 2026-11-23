import { useState } from 'react';

export interface TrendPoint {
  label: string;
  current: number;
  previous: number | null;
}

interface TrendChartProps {
  title: string;
  points: TrendPoint[];
  format: (value: number) => string;
  /** Rótulo curto para o eixo (ex.: "R$ 1,9 mil"); padrão = `format`. */
  formatAxis?: (value: number) => string;
  testId?: string;
}

const W = 560;
const H = 180;
const PAD = { top: 12, right: 12, bottom: 24, left: 72 };

/**
 * Evolução diária de uma métrica (ficha 41): período atual (linha cheia, cor da marca) × período anterior
 * (tracejada, neutra) — uma métrica por gráfico, um eixo só. Passar o mouse mostra os dois valores do dia.
 */
export default function TrendChart({ title, points, format, formatAxis = format, testId }: TrendChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...points.flatMap(point => [point.current, point.previous ?? 0]));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (index: number) => PAD.left + (points.length <= 1 ? innerW / 2 : (index / (points.length - 1)) * innerW);
  const y = (value: number) => PAD.top + innerH - (value / max) * innerH;
  const path = (pick: (point: TrendPoint) => number | null) =>
    points
      .map((point, index) => ({ value: pick(point), index }))
      .filter((entry): entry is { value: number; index: number } => entry.value !== null)
      .map((entry, i) => `${i === 0 ? 'M' : 'L'}${x(entry.index).toFixed(1)},${y(entry.value).toFixed(1)}`)
      .join(' ');
  const ticks = [0, 0.5, 1].map(f => max * f);
  const labelEvery = Math.max(1, Math.ceil(points.length / 6));
  const active = hover !== null ? points[hover] : null;

  return (
    <figure className="bg-card border border-border rounded-xl p-4" data-testid={testId}>
      <figcaption className="flex items-center justify-between gap-3 mb-2">
        <span className="text-sm font-semibold text-foreground">{title}</span>
        <span className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1"><svg width="16" height="4" aria-hidden><line x1="0" y1="2" x2="16" y2="2" className="stroke-primary" strokeWidth="2" /></svg>Período</span>
          <span className="flex items-center gap-1"><svg width="16" height="4" aria-hidden><line x1="0" y1="2" x2="16" y2="2" className="stroke-muted-foreground" strokeWidth="2" strokeDasharray="4 3" /></svg>Anterior</span>
        </span>
      </figcaption>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label={`${title}: gráfico por dia`} onMouseLeave={() => setHover(null)}>
          {ticks.map(tick => (
            <g key={tick}>
              <line x1={PAD.left} x2={W - PAD.right} y1={y(tick)} y2={y(tick)} className="stroke-border" strokeWidth="1" />
              <text x={PAD.left - 6} y={y(tick) + 3} textAnchor="end" className="fill-muted-foreground" fontSize="10">{formatAxis(tick)}</text>
            </g>
          ))}
          {points.map((point, index) =>
            index % labelEvery === 0 || index === points.length - 1 ? (
              <text key={point.label} x={x(index)} y={H - 6} textAnchor="middle" className="fill-muted-foreground" fontSize="10">{point.label}</text>
            ) : null,
          )}
          <path d={path(point => point.previous)} fill="none" className="stroke-muted-foreground" strokeWidth="2" strokeDasharray="4 3" strokeLinejoin="round" />
          <path d={path(point => point.current)} fill="none" className="stroke-primary" strokeWidth="2" strokeLinejoin="round" />
          {active && hover !== null && (
            <>
              <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} className="stroke-muted-foreground" strokeWidth="1" opacity="0.5" />
              <circle cx={x(hover)} cy={y(active.current)} r="4" className="fill-primary stroke-card" strokeWidth="2" />
            </>
          )}
          {points.map((point, index) => (
            <rect key={point.label} x={x(index) - innerW / Math.max(1, points.length) / 2} y={PAD.top} width={Math.max(8, innerW / Math.max(1, points.length))} height={innerH} fill="transparent" onMouseEnter={() => setHover(index)} />
          ))}
        </svg>
        {active && hover !== null && (
          <div className="pointer-events-none absolute top-0 bg-foreground text-background text-xs rounded-lg px-2.5 py-1.5 shadow-lg" style={{ left: `${Math.min(80, (x(hover) / W) * 100)}%` }}>
            <p className="font-semibold">{active.label}</p>
            <p>Período: {format(active.current)}</p>
            {active.previous !== null && <p className="opacity-80">Anterior: {format(active.previous)}</p>}
          </div>
        )}
      </div>
    </figure>
  );
}
