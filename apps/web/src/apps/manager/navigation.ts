import type { ElementType } from 'react';
import { BookOpen, Cake, CalendarCheck, CalendarX2, ChefHat, Clock, Crown, FileSpreadsheet, FileText, LayoutDashboard, LifeBuoy, Map as MapIcon, Network, QrCode, Receipt, Tag, TrendingUp, Users } from 'lucide-react';
import type { PlanFeature } from '@filafacil/shared';

export type ManagerSection = 'floor-plan' | 'waitlist' | 'qrcodes' | 'menu' | 'promotions' | 'recipes' | 'kitchen' | 'shift' | 'dashboard' | 'bookings' | 'coupons' | 'cost-report' | 'expiry' | 'support' | 'invoices' | 'menu-import' | 'plans' | 'campaigns' | 'network';

interface SectionDefinition {
  id: ManagerSection;
  icon: ElementType;
  label: string;
}

export const NAV_GROUPS: { label: string; items: SectionDefinition[] }[] = [
  {
    label: 'Operação',
    items: [
      { id: 'floor-plan', icon: MapIcon, label: 'Planta do salão' },
      { id: 'waitlist', icon: Users, label: 'Fila de espera' },
      { id: 'bookings', icon: CalendarCheck, label: 'Reservas de mesa' },
      { id: 'qrcodes', icon: QrCode, label: 'QR Codes' },
      { id: 'kitchen', icon: ChefHat, label: 'Cozinha' },
      { id: 'shift', icon: Clock, label: 'Turno' },
    ],
  },
  {
    label: 'Gestão',
    items: [
      { id: 'dashboard', icon: LayoutDashboard, label: 'Dashboard' },
      { id: 'network', icon: Network, label: 'Minha rede' },
      { id: 'cost-report', icon: TrendingUp, label: 'Custo por período' },
      { id: 'invoices', icon: Receipt, label: 'Faturas' },
      { id: 'plans', icon: Crown, label: 'Planos' },
      { id: 'support', icon: LifeBuoy, label: 'Suporte' },
    ],
  },
  {
    label: 'Catálogo',
    items: [
      { id: 'menu', icon: BookOpen, label: 'Cardápio' },
      { id: 'menu-import', icon: FileSpreadsheet, label: 'Importar cardápio' },
      { id: 'promotions', icon: Tag, label: 'Promoções' },
      { id: 'coupons', icon: Tag, label: 'Cupons e cashback' },
      { id: 'campaigns', icon: Cake, label: 'Campanhas segmentadas' },
      { id: 'recipes', icon: FileText, label: 'Fichas técnicas' },
      { id: 'expiry', icon: CalendarX2, label: 'Validade de insumos' },
    ],
  },
];

/** Seções liberadas conforme o plano do estabelecimento (ficha 37); as demais estão em todos os planos. */
export const SECTION_FEATURE: Partial<Record<ManagerSection, PlanFeature>> = {
  'floor-plan': 'floor_plan',
  waitlist: 'waitlist',
  promotions: 'promotions',
  recipes: 'recipes',
  coupons: 'promotions',
  campaigns: 'promotions',
  'cost-report': 'recipes',
  expiry: 'recipes',
};

export const sectionLabel = (id: ManagerSection) =>
  NAV_GROUPS.flatMap(group => group.items).find(item => item.id === id)?.label ?? '';
