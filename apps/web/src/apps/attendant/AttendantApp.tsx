import { useState } from 'react';
import { BookOpen, ClipboardList, LogOut, Map as MapIcon } from 'lucide-react';
import type { MeResponse, OrderingStatus } from '@filafacil/shared';
import AccessBlocked from '@/components/layout/AccessBlocked';
import StaffGate from '@/components/layout/StaffGate';
import Toast from '@/components/ui/Toast';
import { useToast } from '@/components/ui/useToast';
import { BRAND } from '@/config/brand';
import { cn, getInitials } from '@/lib/utils';
import { logout } from '@/services/authService';
import { useRestaurant } from '@/services/restaurantService';
import FloorMapSection from './sections/FloorMapSection';
import MenuAvailabilitySection from './sections/MenuAvailabilitySection';
import OrdersSection from './sections/OrdersSection';

type AttendantSection = 'floor' | 'orders' | 'menu';

const SECTIONS = [
  { id: 'floor', icon: MapIcon, label: 'Mapa', title: 'Mapa de mesas' },
  { id: 'orders', icon: ClipboardList, label: 'Pedidos', title: 'Pedidos' },
  { id: 'menu', icon: BookOpen, label: 'Cardápio', title: 'Disponibilidade do cardápio' },
] as const;

const ORDERING_CHIP: Record<OrderingStatus, { label: string; box: string; dot: string }> = {
  open: { label: 'Bar aberto', box: 'bg-success-bg text-success', dot: 'bg-success animate-pulse' },
  busy: { label: 'Alta demanda', box: 'bg-warning-bg text-warning', dot: 'bg-warning animate-pulse' },
  paused: { label: 'Pedidos pausados', box: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground' },
  closed: { label: 'Bar fechado', box: 'bg-error-bg text-error', dot: 'bg-error' },
};

export default function AttendantApp() {
  return (
    // Gestores também podem operar o tablet do salão (têm as mesmas permissões do atendente).
    <StaffGate panelLabel="Tablet do atendente" allowedRoles={['attendant', 'manager']}>
      {me => <AttendantPanel me={me} />}
    </StaffGate>
  );
}

function AttendantPanel({ me }: { me: MeResponse }) {
  const [section, setSection] = useState<AttendantSection>('floor');
  const { toastMessage, showToast } = useToast();
  const membership = me.memberships[0];
  // Página pública: traz o status de pedidos (aberto, alta demanda, pausado, fechado).
  const restaurant = useRestaurant(membership?.establishmentId);

  if (!membership) {
    return (
      <AccessBlocked
        title="Nenhum estabelecimento vinculado"
        description="Seu usuário ainda não está vinculado a um estabelecimento. Peça ao gestor ou à administração."
        action={{ label: 'Sair', onClick: () => void logout() }}
      />
    );
  }
  if (membership.establishmentStatus === 'suspended') {
    return (
      <AccessBlocked
        title="Estabelecimento suspenso"
        description="A administração da plataforma suspendeu este estabelecimento."
        action={{ label: 'Sair', onClick: () => void logout() }}
      />
    );
  }

  const establishmentId = membership.establishmentId;
  const chip = ORDERING_CHIP[restaurant.data?.orderingStatus ?? 'closed'];
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
        <div className="mt-auto flex flex-col items-center gap-3">
          <button onClick={() => void logout()} title="Sair" aria-label="Sair" className="w-8 h-8 rounded-lg flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10">
            <LogOut size={15} />
          </button>
          <div className="w-8 h-8 rounded-full bg-white/10 flex items-center justify-center" title={me.user.name}>
            <span className="text-white/80 text-xs font-bold">{getInitials(me.user.name)}</span>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="bg-card border-b border-border px-6 py-3 flex items-center justify-between flex-shrink-0 gap-4">
          <div>
            <h1 className="font-display font-bold text-foreground">{current.title}</h1>
            <p className="text-xs text-muted-foreground">
              {membership.establishmentName} · {me.user.name}
            </p>
          </div>
          <div className={cn('flex items-center gap-2 px-3 py-1.5 rounded-lg', chip.box)}>
            <div className={cn('w-1.5 h-1.5 rounded-full', chip.dot)} />
            <span className="text-xs font-medium">{chip.label}</span>
          </div>
        </header>

        {section === 'floor' && <FloorMapSection establishmentId={establishmentId} notify={showToast} />}
        {section === 'orders' && (
          <OrdersSection establishmentId={establishmentId} canRefund={me.user.permissions.includes('orders.refund')} notify={showToast} />
        )}
        {section === 'menu' && <MenuAvailabilitySection establishmentId={establishmentId} notify={showToast} />}
      </div>
      <Toast message={toastMessage} />
    </div>
  );
}
