import { useId, type CSSProperties, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode, type Ref } from 'react';
import { cn } from '@/lib/utils';
import type { FloorTable } from '@/types/floor';
import { mergeBoxStyle, tableDimensions } from './tableStyles';

interface FloorCanvasProps {
  canvasRef?: Ref<HTMLDivElement>;
  /** Editor: desativa rolagem por toque para permitir arrastar as mesas. */
  editable?: boolean;
  onBackgroundClick?: () => void;
  children: ReactNode;
}

/** Área da planta do salão . */
export default function FloorCanvas({ canvasRef, editable, onBackgroundClick, children }: FloorCanvasProps) {
  const patternId = useId();
  return (
    <div
      ref={canvasRef}
      onClick={event => event.target === event.currentTarget && onBackgroundClick?.()}
      className={cn(
        'relative w-full aspect-[16/10] rounded-xl overflow-hidden bg-[#E8E3DC] border border-border select-none',
        editable && 'touch-none',
      )}
    >
      <svg className="absolute inset-0 w-full h-full opacity-40 pointer-events-none" aria-hidden="true">
        <defs>
          <pattern id={patternId} width="40" height="40" patternUnits="userSpaceOnUse">
            <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#C4BCB4" strokeWidth="1" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${patternId})`} />
      </svg>
      {children}
    </div>
  );
}

interface TableNodeProps {
  table: FloorTable;
  /** Classes de cor (fundo translúcido + borda + texto) aplicadas sobre uma base opaca. */
  toneClassName: string;
  selected?: boolean;
  highlight?: boolean;
  ariaLabel: string;
  children: ReactNode;
  onClick?: (event: MouseEvent<HTMLButtonElement>) => void;
  onPointerDown?: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove?: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp?: (event: PointerEvent<HTMLButtonElement>) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLButtonElement>) => void;
  className?: string;
}

export function TableNode({
  table, toneClassName, selected, highlight, ariaLabel, children, className, ...handlers
}: TableNodeProps) {
  const { width, height } = tableDimensions(table);
  const style: CSSProperties = { left: `${table.x}%`, top: `${table.y}%`, width, height, transform: 'translate(-50%, -50%)' };
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-pressed={selected}
      style={style}
      className={cn(
        'absolute z-10 bg-card shadow-sm transition-shadow',
        table.shape === 'round' ? 'rounded-full' : 'rounded-xl',
        selected && 'ring-2 ring-offset-2 ring-offset-[#E8E3DC] ring-foreground/40',
        highlight && 'ring-2 ring-offset-2 ring-offset-[#E8E3DC] ring-error animate-pulse',
        className,
      )}
      {...handlers}
    >
      <span
        className={cn(
          'absolute inset-0 border-2 flex flex-col items-center justify-center gap-0.5 leading-none',
          table.shape === 'round' ? 'rounded-full' : 'rounded-xl',
          toneClassName,
        )}
      >
        {children}
      </span>
    </button>
  );
}

interface MergeBlockProps {
  members: FloorTable[];
  /** `outline`: contorno tracejado no editor; `unit`: bloco único no mapa do atendente. */
  variant: 'outline' | 'unit';
  toneClassName?: string;
  selected?: boolean;
  highlight?: boolean;
  ariaLabel: string;
  onClick?: () => void;
  children: ReactNode;
}

export function MergeBlock({ members, variant, toneClassName, selected, highlight, ariaLabel, onClick, children }: MergeBlockProps) {
  const style = mergeBoxStyle(members);
  if (variant === 'outline') {
    return (
      <div
        style={style}
        className={cn(
          'absolute z-0 rounded-2xl border-2 border-dashed transition-colors',
          selected ? 'border-primary bg-primary/10' : 'border-primary/50 bg-primary/5',
        )}
      >
        <button
          type="button"
          onClick={onClick}
          aria-label={ariaLabel}
          aria-pressed={selected}
          className="absolute -top-3 left-3 z-20 bg-primary text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow whitespace-nowrap"
        >
          {children}
        </button>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-pressed={selected}
      style={style}
      className={cn(
        'absolute z-10 rounded-2xl bg-card shadow-sm',
        selected && 'ring-2 ring-offset-2 ring-offset-[#E8E3DC] ring-foreground/40',
        highlight && 'ring-2 ring-offset-2 ring-offset-[#E8E3DC] ring-error animate-pulse',
      )}
    >
      <span className={cn('absolute inset-0 rounded-2xl border-2 flex flex-col items-center justify-center gap-0.5 leading-none', toneClassName)}>
        {children}
      </span>
    </button>
  );
}
