import { useState } from 'react';
import { Building2 } from 'lucide-react';
import { PLAN_FEATURE_LABELS, type MeResponse } from '@filafacil/shared';
import AccessBlocked from '@/components/layout/AccessBlocked';
import PanelLayout from '@/components/layout/PanelLayout';
import PlanLockedNotice from '@/components/layout/PlanLockedNotice';
import StaffGate from '@/components/layout/StaffGate';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import Toast from '@/components/ui/Toast';
import { useToast } from '@/components/ui/useToast';
import { logout } from '@/services/authService';
import { useEstablishmentPlan } from '@/services/planService';
import UnitSelector from './components/UnitSelector';
import { NAV_GROUPS, SECTION_FEATURE, sectionLabel, type ManagerSection } from './navigation';
import FloorPlanSection from './sections/floor/FloorPlanSection';
import MenuSection from './sections/menu/MenuSection';
import PromotionsSection from './sections/promotions/PromotionsSection';
import QRCodesSection from './sections/QRCodesSection';
import RecipesSection from './sections/recipes/RecipesSection';
import KitchenSection from './sections/kitchen/KitchenSection';
import ShiftSection from './sections/shift/ShiftSection';
import DashboardSection from './sections/dashboard/DashboardSection';
import AlertsBanner from '@/components/layout/AlertsBanner';
import WaitlistSection from './sections/waitlist/WaitlistSection';
import BookingsSection from './sections/sprint4/BookingsSection';
import CouponsSection from './sections/sprint4/CouponsSection';
import CostReportSection from './sections/sprint4/CostReportSection';
import ExpirySection from './sections/sprint4/ExpirySection';
import InvoicesSection from './sections/sprint4/InvoicesSection';
import SupportSection from './sections/sprint4/SupportSection';
import NotificationsBell from './components/NotificationsBell';
import type { ManagerSectionProps, ManagerUnit } from './types';

const toUnits = (me: MeResponse): ManagerUnit[] =>
  me.memberships.map(m => ({ id: m.establishmentId, name: m.establishmentName, status: m.establishmentStatus, address: m.address, organizationId: m.organizationId }));

export default function ManagerApp() {
  return (
    <StaffGate panelLabel="Painel gestor" allowedRoles={['manager']}>
      {me => <ManagerPanel me={me} />}
    </StaffGate>
  );
}

function ManagerPanel({ me }: { me: MeResponse }) {
  const units = toUnits(me);
  const [activeUnitId, setActiveUnitId] = useState(units[0]?.id ?? '');
  const [section, setSection] = useState<ManagerSection>('menu');
  const { toastMessage, showToast } = useToast();
  const activeUnit = units.find(u => u.id === activeUnitId) ?? units[0];
  const features = useEstablishmentPlan(activeUnit?.id ?? '').data?.features;

  if (!activeUnit) {
    return (
      <AccessBlocked
        title="Nenhuma unidade vinculada"
        description="Seu usuário ainda não está vinculado a um estabelecimento. Peça ao administrador da plataforma."
        action={{ label: 'Sair', onClick: () => void logout() }}
      />
    );
  }

  return (
    <>
      <PanelLayout
        panelLabel="Painel gestor"
        groups={NAV_GROUPS.map(group => ({
          label: group.label,
          items: group.items.map(item => {
            const feature = SECTION_FEATURE[item.id];
            return { ...item, locked: Boolean(feature && features && !features.includes(feature)) };
          }),
        }))}
        active={section}
        onNavigate={setSection}
        user={{ name: me.user.name, role: 'Gestor' }}
        onSignOut={() => void logout()}
        title={sectionLabel(section)}
        sidebarSlot={<UnitSelector units={units} activeId={activeUnit.id} onSelect={setActiveUnitId} />}
        headerRight={
          <div className="flex items-center gap-2">
            <NotificationsBell establishmentId={activeUnit.id} onOpen={kind => setSection(sectionForNotification(kind) ?? section)} />
            <div className="flex items-center gap-2 bg-muted border border-border rounded-xl px-3 py-2 text-sm">
              <Building2 size={14} className="text-muted-foreground" />
              <span className="font-medium text-foreground">{activeUnit.name}</span>
            </div>
          </div>
        }
      >
        {/* A troca de unidade remonta a seção e descarta rascunhos da unidade anterior. */}
        <UnitSection
          key={`${activeUnit.id}-${section}`}
          section={section}
          sectionProps={{ unit: activeUnit, units: units.filter(u => u.organizationId === activeUnit.organizationId), notify: showToast }}
          onOpenFloorPlan={() => setSection('floor-plan')}
        />
      </PanelLayout>
      <Toast message={toastMessage} />
    </>
  );
}

/** Para onde o aviso leva o gestor ao ser aberto. */
const sectionForNotification = (kind: string): ManagerSection | null =>
  kind.startsWith('support_') ? 'support' : kind.startsWith('invoice_') ? 'invoices' : kind === 'ingredient_expiring' ? 'expiry' : null;

interface UnitSectionProps {
  section: ManagerSection;
  sectionProps: ManagerSectionProps;
  onOpenFloorPlan: () => void;
}

/** Seção ativa, liberada ou bloqueada conforme o plano vigente da unidade (a API aplica a mesma regra). */
function UnitSection({ section, sectionProps, onOpenFloorPlan }: UnitSectionProps) {
  const plan = useEstablishmentPlan(sectionProps.unit.id);

  if (sectionProps.unit.status === 'suspended') {
    return (
      <PlanLockedNotice
        feature={sectionProps.unit.name}
        title="Estabelecimento suspenso"
        description="A administração da plataforma suspendeu esta unidade. Fale com o suporte para regularizar."
      />
    );
  }
  if (plan.error) return <ErrorBlock error={plan.error} onRetry={() => void plan.refetch()} />;
  if (!plan.data) return <LoadingBlock />;

  const feature = SECTION_FEATURE[section];
  if (feature && !plan.data.features.includes(feature)) {
    return <PlanLockedNotice feature={PLAN_FEATURE_LABELS[feature]} planName={plan.data.name} />;
  }

  return (
    <>
      <AlertsBanner establishmentId={sectionProps.unit.id} notify={sectionProps.notify} />
      {section === 'menu' && <MenuSection {...sectionProps} />}
      {section === 'promotions' && <PromotionsSection {...sectionProps} />}
      {section === 'recipes' && <RecipesSection {...sectionProps} />}
      {section === 'floor-plan' && <FloorPlanSection {...sectionProps} />}
      {section === 'waitlist' && <WaitlistSection {...sectionProps} />}
      {section === 'kitchen' && <KitchenSection {...sectionProps} />}
      {section === 'shift' && <ShiftSection {...sectionProps} />}
      {section === 'dashboard' && <DashboardSection {...sectionProps} />}
      {section === 'bookings' && <BookingsSection {...sectionProps} />}
      {section === 'coupons' && <CouponsSection {...sectionProps} />}
      {section === 'cost-report' && <CostReportSection {...sectionProps} />}
      {section === 'expiry' && <ExpirySection {...sectionProps} />}
      {section === 'support' && <SupportSection {...sectionProps} />}
      {section === 'invoices' && <InvoicesSection {...sectionProps} />}
      {section === 'qrcodes' && <QRCodesSection {...sectionProps} onOpenFloorPlan={onOpenFloorPlan} />}
    </>
  );
}
