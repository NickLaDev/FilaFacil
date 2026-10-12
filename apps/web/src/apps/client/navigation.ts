import { BookOpen, Home, ShoppingBag, User, Utensils, type LucideIcon } from 'lucide-react';
import type { ClientScreen } from './types';

export interface Tab {
  id: string;
  label: string;
  icon: LucideIcon;
  screens: ClientScreen[];
  destination: ClientScreen;
}

const ORDERS_TAB: Tab = { id: 'orders', label: 'Pedidos', icon: ShoppingBag, screens: ['orders', 'order-tracking', 'receipt', 'order-confirmed', 'cart'], destination: 'orders' };
const PROFILE_TAB: Tab = { id: 'profile', label: 'Perfil', icon: User, screens: ['profile', 'edit-profile', 'addresses', 'account-security', 'favorites', 'reservations'], destination: 'profile' };

export const TABS_IN_BAR: Tab[] = [
  { id: 'home', label: 'Início', icon: Home, screens: ['home-in-bar'], destination: 'home-in-bar' },
  { id: 'menu', label: 'Cardápio', icon: BookOpen, screens: ['menu', 'item-detail'], destination: 'menu' },
  ORDERS_TAB,
  PROFILE_TAB,
];

export const TABS_GLOBAL: Tab[] = [
  { id: 'home', label: 'Início', icon: Home, screens: ['home-out-of-bar'], destination: 'home-out-of-bar' },
  { id: 'restaurants', label: 'Restaurantes', icon: Utensils, screens: ['explore', 'restaurant-detail', 'location', 'menu', 'item-detail'], destination: 'explore' },
  ORDERS_TAB,
  PROFILE_TAB,
];

export const BOTTOM_NAV_SCREENS = new Set<ClientScreen>([...TABS_IN_BAR, ...TABS_GLOBAL].flatMap(tab => tab.screens).filter(s => s !== 'cart'));
