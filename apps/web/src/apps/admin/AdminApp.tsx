import { useState } from 'react';
import { Activity, Building2, DollarSign, History, LifeBuoy, Receipt, Users } from 'lucide-react';
import PanelLayout, { type PanelNavGroup } from '@/components/layout/PanelLayout';
import StaffGate from '@/components/layout/StaffGate';
import Toast from '@/components/ui/Toast';
import { useToast } from '@/components/ui/useToast';
import { logout } from '@/services/authService';
import EstablishmentsSection from './sections/EstablishmentsSection';
import PlansSection from './sections/PlansSection';
import UsersSection from './sections/UsersSection';
import BillingSection from './sections/BillingSection';
import HistorySection from './sections/HistorySection';
import MonitoringSection from './sections/MonitoringSection';
import SupportSection from './sections/SupportSection';

type AdminSection = 'establishments' | 'users' | 'plans' | 'monitoring' | 'billing' | 'support' | 'history';

const NAV_GROUPS: PanelNavGroup<AdminSection>[] = [
  {
    items: [
      { id: 'establishments', icon: Building2, label: 'Estabelecimentos' },
      { id: 'users', icon: Users, label: 'Usuários' },
      { id: 'plans', icon: DollarSign, label: 'Planos' },
    ],
  },
  {
    label: 'Plataforma',
    items: [
      { id: 'monitoring', icon: Activity, label: 'Incidentes' },
      { id: 'billing', icon: Receipt, label: 'Pagamentos' },
      { id: 'support', icon: LifeBuoy, label: 'Suporte' },
      { id: 'history', icon: History, label: 'Histórico' },
    ],
  },
];

const SECTION_TITLES: Record<AdminSection, string> = {
  establishments: 'Estabelecimentos',
  users: 'Usuários da plataforma',
  plans: 'Planos de assinatura',
  monitoring: 'Integrações e incidentes',
  billing: 'Pagamentos da plataforma',
  support: 'Central de suporte',
  history: 'Histórico de alterações dos estabelecimentos',
};

export default function AdminApp() {
  const [section, setSection] = useState<AdminSection>('establishments');
  const { toastMessage, showToast } = useToast();

  return (
    <StaffGate panelLabel="Painel admin" allowedRoles={['admin']}>
      {me => (
        <PanelLayout
          panelLabel="Painel admin"
          groups={NAV_GROUPS}
          active={section}
          onNavigate={setSection}
          user={{ name: me.user.name, role: 'Plataforma' }}
          onSignOut={() => void logout()}
          title={SECTION_TITLES[section]}
        >
          {section === 'establishments' && <EstablishmentsSection notify={showToast} />}
          {section === 'users' && <UsersSection notify={showToast} currentUserId={me.user.id} />}
          {section === 'plans' && <PlansSection notify={showToast} />}
          {section === 'monitoring' && <MonitoringSection notify={showToast} />}
          {section === 'billing' && <BillingSection notify={showToast} />}
          {section === 'support' && <SupportSection notify={showToast} />}
          {section === 'history' && <HistorySection />}
          <Toast message={toastMessage} />
        </PanelLayout>
      )}
    </StaffGate>
  );
}
