import { BRAND } from '@/config/brand';
import { cn } from '@/lib/utils';

const BRAND_ORANGE = '#E8700A';
const BRAND_INK = '#18160F';

interface MarkProps {
  size?: number;
  color?: string;
  className?: string;
}

// Barras da fila diminuindo + seta para frente: a fila zerando.
export function BrandMark({ size = 40, color = 'currentColor', className }: MarkProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" className={className} aria-hidden="true">
      <rect x="2" y="4" width="22" height="6.5" rx="3.25" fill={color} />
      <rect x="2" y="16.75" width="17" height="6.5" rx="3.25" fill={color} />
      <rect x="2" y="29.5" width="12" height="6.5" rx="3.25" fill={color} />
      <path d="M28 3 L38 20 L28 37" stroke={color} strokeWidth="6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const SIZE_CONFIG = {
  sm: { mark: 22, fontSize: 16, gap: 8, tracking: '-0.02em' },
  md: { mark: 30, fontSize: 22, gap: 10, tracking: '-0.025em' },
  lg: { mark: 40, fontSize: 30, gap: 13, tracking: '-0.03em' },
};

interface LogoProps {
  size?: keyof typeof SIZE_CONFIG;
  variant?: 'light' | 'color';
  className?: string;
}

export function BrandLogo({ size = 'md', variant = 'color', className }: LogoProps) {
  const config = SIZE_CONFIG[size];
  const isLight = variant === 'light';
  return (
    <div className={cn('flex items-center', className)} style={{ gap: config.gap }}>
      <BrandMark size={config.mark} color={isLight ? '#FFFFFF' : BRAND_ORANGE} />
      <span
        className="font-display"
        style={{ fontWeight: 800, fontSize: config.fontSize, letterSpacing: config.tracking, lineHeight: 1, color: isLight ? '#FFFFFF' : BRAND_INK }}
      >
        {BRAND.name}
      </span>
    </div>
  );
}

export function BrandAppIcon({ size = 56, className }: { size?: number; className?: string }) {
  const markSize = Math.round(size * 0.6);
  return (
    <div
      className={cn('flex items-center justify-center flex-shrink-0', className)}
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.24),
        background: 'linear-gradient(140deg, #F07C1A 0%, #E8700A 55%, #D4600A 100%)',
        boxShadow: '0 4px 16px rgba(232, 112, 10, 0.35)',
      }}
    >
      <BrandMark size={markSize} color="rgba(255,255,255,0.95)" />
    </div>
  );
}

/** Marca compacta para cabeçalhos. */
export function BrandBadge({ className }: { className?: string }) {
  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <BrandMark size={18} color={BRAND_ORANGE} />
      <span className="font-display" style={{ fontWeight: 800, fontSize: 15, letterSpacing: '-0.02em', color: BRAND_INK }}>
        {BRAND.name}
      </span>
    </div>
  );
}
