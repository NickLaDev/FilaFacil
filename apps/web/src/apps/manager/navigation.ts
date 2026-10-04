import type { ElementType } from 'react';
import { BookOpen, FileText, Map as MapIcon, QrCode, Tag, Users } from 'lucide-react';
import type { PlanFeature } from '@filafacil/shared';

export type ManagerSection = 'floor-plan' | 'waitlist' | 'qrcodes' | 'menu' | 'promotions' | 'recipes';

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
      { id: 'qrcodes', icon: QrCode, label: 'QR Codes' },
    ],
  },
  {
    label: 'Catálogo',
    items: [
      { id: 'menu', icon: BookOpen, label: 'Cardápio' },
      { id: 'promotions', icon: Tag, label: 'Promoções' },
      { id: 'recipes', icon: FileText, label: 'Fichas técnicas' },
    ],
  },
];

/** Seções liberadas conforme o plano do estabelecimento (ficha 37); as demais estão em todos os planos. */
export const SECTION_FEATURE: Partial<Record<ManagerSection, PlanFeature>> = {
  'floor-plan': 'floor_plan',
  waitlist: 'waitlist',
  promotions: 'promotions',
  recipes: 'recipes',
};

export const sectionLabel = (id: ManagerSection) =>
  NAV_GROUPS.flatMap(group => group.items).find(item => item.id === id)?.label ?? '';
