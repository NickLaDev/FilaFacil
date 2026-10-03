import { useState } from 'react';
import { Building2 } from 'lucide-react';
import AccessBlocked from '@/components/layout/AccessBlocked';
import PanelLayout from '@/components/layout/PanelLayout';
import PlanLockedNotice from '@/components/layout/PlanLockedNotice';
import Toast from '@/components/ui/Toast';
import { useToast } from '@/components/ui/useToast';
import { PLAN_FEATURE_LABELS } from '@/data/establishments';
import { CURRENT_STAFF_USER_ID } from '@/data/users';
import { useEstablishment, useOrganizationUnits } from '@/services/establishmentService';
import { useEstablishmentPlan } from '@/services/planService';
import { useIsSuspended, usePlatformUser } from '@/services/platformUserService';
import UnitSelector from './components/UnitSelector';
import { NAV_GROUPS, SECTION_FEATURE, sectionLabel, type ManagerSection } from './navigation';
import FloorPlanSection from './sections/floor/FloorPlanSection';
import MenuSection from './sections/menu/MenuSection';
import PromotionsSection from './sections/promotions/PromotionsSection';
import QRCodesSection from './sections/QRCodesSection';
import RecipesSection from './sections/recipes/RecipesSection';
import WaitlistSection from './sections/waitlist/WaitlistSection';
import type { ManagerSectionProps } from './types';

/** Unidade padrão caso o gestor não tenha estabelecimento vinculado. */
const FALLBACK_ESTABLISHMENT_ID = 'r1';

export default function ManagerApp() {
  const manager = usePlatformUser(CURRENT_STAFF_USER_ID.manager);
  const suspended = useIsSuspended({ id: CURRENT_STAFF_USER_ID.manager });
  const homeUnit = useEstablishment(manager?.establishmentId ?? FALLBACK_ESTABLISHMENT_ID);
  const units = useOrganizationUnits(homeUnit?.organizationId ?? '');
  const [activeUnitId, setActiveUnitId] = useState(manager?.establishmentId ?? FALLBACK_ESTABLISHMENT_ID);
  const [section, setSection] = useState<ManagerSection>('menu');
  const plan = useEstablishmentPlan(activeUnitId);
  const { toastMessage, showToast } = useToast();

  if (suspended) return <AccessBlocked />;
  const activeUnit = units.find(u => u.id === activeUnitId) ?? homeUnit;
  if (!activeUnit) return <AccessBlocked title="Unidade indisponível" description="Nenhum estabelecimento vinculado a este gestor." />;

  const features = plan?.features ?? [];
  const lockedFeature = (id: ManagerSection) => {
    const feature = SECTION_FEATURE[id];
    return feature && !features.includes(feature) ? feature : null;
  };
  const groups = NAV_GROUPS.map(group => ({
    label: group.label,
    items: group.items.map(item => ({ ...item, locked: lockedFeature(item.id) !== null })),
  }));
  const sectionProps: ManagerSectionProps = { unit: activeUnit, actorName: manager?.name ?? 'Gestor', notify: showToast };
  const locked = lockedFeature(section);

  return (
    <>
      <PanelLayout
        panelLabel="Painel gestor"
        groups={groups}
        active={section}
        onNavigate={setSection}
        user={{ name: manager?.name ?? 'Gestor', role: 'Gestor' }}
        title={sectionLabel(section)}
        sidebarSlot={<UnitSelector units={units} activeId={activeUnit.id} onSelect={setActiveUnitId} />}
        headerRight={
          <div className="flex items-center gap-2 bg-muted border border-border rounded-xl px-3 py-2 text-sm">
            <Building2 size={14} className="text-muted-foreground" />
            <span className="font-medium text-foreground">{activeUnit.name}</span>
          </div>
        }
      >
        {/* A troca de unidade remonta a seção e descarta rascunhos da unidade anterior. */}
        <div key={`${activeUnit.id}-${section}`}>
          {locked ? (
            <PlanLockedNotice feature={PLAN_FEATURE_LABELS[locked]} planName={plan?.name} />
          ) : (
            <>
              {section === 'menu' && <MenuSection {...sectionProps} />}
              {section === 'promotions' && <PromotionsSection {...sectionProps} />}
              {section === 'recipes' && <RecipesSection {...sectionProps} />}
              {section === 'floor-plan' && <FloorPlanSection {...sectionProps} />}
              {section === 'waitlist' && <WaitlistSection {...sectionProps} />}
              {section === 'qrcodes' && <QRCodesSection {...sectionProps} onOpenFloorPlan={() => setSection('floor-plan')} />}
            </>
          )}
        </div>
      </PanelLayout>
      <Toast message={toastMessage} />
    </>
  );
}
