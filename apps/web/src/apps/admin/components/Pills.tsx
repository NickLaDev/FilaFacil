import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';
import type { EstablishmentStatus } from '@filafacil/shared';

const PLAN_COLORS: Record<string, string> = {
  Start: 'bg-muted text-muted-foreground',
  Pro: 'bg-primary/10 text-primary',
  Business: 'bg-blue-500/10 text-blue-500',
};

const ESTABLISHMENT_STATUS: Record<EstablishmentStatus, { label: string; className: string }> = {
  active: { label: 'Ativo', className: 'bg-success/10 text-success' },
  inactive: { label: 'Inativo', className: 'bg-muted text-muted-foreground' },
  suspended: { label: 'Suspenso', className: 'bg-error/10 text-error' },
};

export function Pill({ className, children }: { className: string; children: ReactNode }) {
  return <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full whitespace-nowrap', className)}>{children}</span>;
}

export function PlanPill({ name }: { name: string }) {
  return <Pill className={PLAN_COLORS[name] ?? 'bg-muted text-muted-foreground'}>{name}</Pill>;
}

export function EstablishmentStatusPill({ status }: { status: EstablishmentStatus }) {
  const { label, className } = ESTABLISHMENT_STATUS[status];
  return <Pill className={className}>{label}</Pill>;
}
