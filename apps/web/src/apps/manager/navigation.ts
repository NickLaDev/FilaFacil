import type { ElementType } from 'react';
import { BookOpen, CalendarCheck, CalendarX2, ChefHat, Clock, FileText, LayoutDashboard, LifeBuoy, Map as MapIcon, QrCode, Receipt, Tag, TrendingUp, Users } from 'lucide-react';
import type { PlanFeature } from '@filafacil/shared';

export type ManagerSection = 'floor-plan' | 'waitlist' | 'qrcodes' | 'menu' | 'promotions' | 'recipes' | 'kitchen' | 'shift' | 'dashboard' | 'bookings' | 'coupons' | 'cost-report' | 'expiry' | 'support' | 'invoices';

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
      { id: 'cost-report', icon: TrendingUp, label: 'Custo por período' },
      { id: 'invoices', icon: Receipt, label: 'Faturas' },
      { id: 'support', icon: LifeBuoy, label: 'Suporte' },
    ],
  },
  {
    label: 'Catálogo',
    items: [
      { id: 'menu', icon: BookOpen, label: 'Cardápio' },
      { id: 'promotions', icon: Tag, label: 'Promoções' },
      { id: 'coupons', icon: Tag, label: 'Cupons e cashback' },
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
  'cost-report': 'recipes',
  expiry: 'recipes',
};

export const sectionLabel = (id: ManagerSection) =>
  NAV_GROUPS.flatMap(group => group.items).find(item => item.id === id)?.label ?? '';
