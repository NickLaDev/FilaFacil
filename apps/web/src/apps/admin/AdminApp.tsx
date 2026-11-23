import { useState } from 'react';
import { Activity, BarChart3, Building2, DollarSign, FileClock, Handshake, History, LayoutDashboard, LifeBuoy, Network, Receipt, Settings, ShieldCheck, Users } from 'lucide-react';
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
import AccessSection from './sections/AccessSection';
import AuditSection from './sections/AuditSection';
import MetricsSection from './sections/MetricsSection';
import OrganizationsSection from './sections/OrganizationsSection';
import OverviewSection from './sections/OverviewSection';
import PartnersSection from './sections/PartnersSection';
import SettingsSection from './sections/SettingsSection';

type AdminSection = 'overview' | 'metrics' | 'establishments' | 'organizations' | 'partners' | 'users' | 'plans' | 'monitoring' | 'billing' | 'support' | 'history' | 'audit' | 'access' | 'settings';

const NAV_GROUPS: PanelNavGroup<AdminSection>[] = [
  {
    items: [
      { id: 'overview', icon: LayoutDashboard, label: 'Visão geral' },
      { id: 'metrics', icon: BarChart3, label: 'Métricas' },
    ],
  },
  {
    label: 'Cadastros',
    items: [
      { id: 'establishments', icon: Building2, label: 'Estabelecimentos' },
      { id: 'organizations', icon: Network, label: 'Organizações' },
      { id: 'partners', icon: Handshake, label: 'Novos parceiros' },
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
  {
    label: 'Segurança',
    items: [
      { id: 'audit', icon: FileClock, label: 'Auditoria' },
      { id: 'access', icon: ShieldCheck, label: 'Acessos' },
      { id: 'settings', icon: Settings, label: 'Configurações' },
    ],
  },
];

const SECTION_TITLES: Record<AdminSection, string> = {
  overview: 'Visão geral da plataforma',
  metrics: 'Métricas da plataforma',
  organizations: 'Organizações (redes)',
  partners: 'Aprovação de novos parceiros',
  audit: 'Auditoria de ações sensíveis',
  access: 'Log de acessos e dispositivos',
  settings: 'Configurações da plataforma',
  establishments: 'Estabelecimentos',
  users: 'Usuários da plataforma',
  plans: 'Planos de assinatura',
  monitoring: 'Integrações externas e incidentes',
  billing: 'Pagamentos da plataforma',
  support: 'Central de suporte',
  history: 'Histórico de alterações dos estabelecimentos',
};

export default function AdminApp() {
  const [section, setSection] = useState<AdminSection>('overview');
  const [establishmentSearch, setEstablishmentSearch] = useState('');
  const { toastMessage, showToast } = useToast();

  return (
    <StaffGate panelLabel="Painel admin" allowedRoles={['admin']}>
      {me => (
        <PanelLayout
          panelLabel="Painel admin"
          groups={NAV_GROUPS}
          active={section}
          onNavigate={next => {
            if (next !== 'establishments') setEstablishmentSearch('');
            setSection(next);
          }}
          user={{ name: me.user.name, role: 'Plataforma' }}
          onSignOut={() => void logout()}
          title={SECTION_TITLES[section]}
        >
          {section === 'overview' && <OverviewSection onNavigate={setSection} />}
          {section === 'metrics' && <MetricsSection />}
          {section === 'establishments' && <EstablishmentsSection key={establishmentSearch} notify={showToast} initialSearch={establishmentSearch} />}
          {section === 'organizations' && (
            <OrganizationsSection
              notify={showToast}
              onOpenEstablishment={name => {
                setEstablishmentSearch(name);
                setSection('establishments');
              }}
            />
          )}
          {section === 'partners' && <PartnersSection notify={showToast} />}
          {section === 'audit' && <AuditSection />}
          {section === 'access' && <AccessSection notify={showToast} />}
          {section === 'settings' && <SettingsSection notify={showToast} />}
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
