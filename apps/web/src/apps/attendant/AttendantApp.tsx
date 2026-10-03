import { useState } from 'react';
import { BookOpen, Map as MapIcon } from 'lucide-react';
import AccessBlocked from '@/components/layout/AccessBlocked';
import { BRAND } from '@/config/brand';
import { CURRENT_STAFF_USER_ID } from '@/data/users';
import { cn, getInitials } from '@/lib/utils';
import { useEstablishment } from '@/services/establishmentService';
import { useIsSuspended, usePlatformUser } from '@/services/platformUserService';
import type { OrderingStatus } from '@/types/establishment';
import FloorMapSection from './sections/FloorMapSection';
import MenuAvailabilitySection from './sections/MenuAvailabilitySection';

type AttendantSection = 'floor' | 'menu';

const SECTIONS = [
  { id: 'floor', icon: MapIcon, label: 'Mapa', title: 'Mapa de mesas' },
  { id: 'menu', icon: BookOpen, label: 'Cardápio', title: 'Disponibilidade do cardápio' },
] as const;

const ORDERING_CHIP: Record<OrderingStatus, { label: string; box: string; dot: string }> = {
  open: { label: 'Bar aberto', box: 'bg-success-bg text-success', dot: 'bg-success animate-pulse' },
  busy: { label: 'Alta demanda', box: 'bg-warning-bg text-warning', dot: 'bg-warning animate-pulse' },
  paused: { label: 'Pedidos pausados', box: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground' },
  closed: { label: 'Bar fechado', box: 'bg-error-bg text-error', dot: 'bg-error' },
};

/** Unidade padrão caso o usuário de equipe não tenha estabelecimento vinculado. */
const FALLBACK_ESTABLISHMENT_ID = 'r1';

export default function AttendantApp() {
  const [section, setSection] = useState<AttendantSection>('floor');
  const attendant = usePlatformUser(CURRENT_STAFF_USER_ID.attendant);
  const suspended = useIsSuspended({ id: CURRENT_STAFF_USER_ID.attendant });
  const establishmentId = attendant?.establishmentId ?? FALLBACK_ESTABLISHMENT_ID;
  const establishment = useEstablishment(establishmentId);

  if (suspended) return <AccessBlocked />;

  const attendantName = attendant?.name ?? 'Atendente';
  const chip = ORDERING_CHIP[establishment?.orderingStatus ?? 'open'];
  const current = SECTIONS.find(s => s.id === section) ?? SECTIONS[0];

  return (
    <div className="h-screen bg-background flex overflow-hidden">
      <aside className="w-16 bg-[#18160F] flex flex-col items-center py-5 gap-6 flex-shrink-0">
        <div className="w-10 h-10 rounded-xl bg-primary flex items-center justify-center">
          <span className="text-white font-display font-bold text-sm">{BRAND.initials}</span>
        </div>
        <nav className="flex flex-col gap-3 mt-4">
          {SECTIONS.map(({ id, icon: Icon, label }) => (
            <button
              key={id}
              onClick={() => setSection(id)}
              title={label}
              aria-label={label}
              aria-current={section === id ? 'page' : undefined}
              className={cn('relative w-10 h-10 rounded-xl flex items-center justify-center transition-colors', section === id ? 'bg-primary' : 'hover:bg-white/10')}
            >
              <Icon size={18} className={section === id ? 'text-white' : 'text-white/60'} />
            </button>
          ))}
        </nav>
        <div className="mt-auto">
          <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center" title={attendantName}>
            <span className="text-white/80 text-xs font-bold">{getInitials(attendantName)}</span>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="bg-card border-b border-border px-6 py-3 flex items-center justify-between flex-shrink-0 gap-4">
          <div>
            <h1 className="font-display font-bold text-foreground">{current.title}</h1>
            <p className="text-xs text-muted-foreground">
              {establishment?.name ?? '—'} · {attendantName}
            </p>
          </div>
          <div className={cn('flex items-center gap-2 px-3 py-1.5 rounded-lg', chip.box)}>
            <div className={cn('w-1.5 h-1.5 rounded-full', chip.dot)} />
            <span className="text-xs font-medium">{chip.label}</span>
          </div>
        </header>

        {section === 'floor' && <FloorMapSection establishmentId={establishmentId} />}
        {section === 'menu' && <MenuAvailabilitySection establishmentId={establishmentId} actorName={attendantName} />}
      </div>
    </div>
  );
}
