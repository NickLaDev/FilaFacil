import type { ElementType, ReactNode } from 'react';
import { Lock } from 'lucide-react';
import { BRAND } from '@/config/brand';
import { BrandMark } from '@/components/brand/Logo';
import { cn, formatDate, getInitials } from '@/lib/utils';

export interface PanelNavItem<T extends string> {
  id: T;
  icon: ElementType;
  label: string;
  /** Recurso fora do plano contratado: aparece com cadeado. */
  locked?: boolean;
}

export interface PanelNavGroup<T extends string> {
  label?: string;
  items: PanelNavItem<T>[];
}

interface PanelLayoutProps<T extends string> {
  panelLabel: string;
  groups: PanelNavGroup<T>[];
  active: T;
  onNavigate: (id: T) => void;
  user: { name: string; role: string };
  title: string;
  sidebarSlot?: ReactNode;
  headerRight?: ReactNode;
  children: ReactNode;
}

/** Casca dos painéis Gestor e Admin: sidebar escura + cabeçalho (visual do protótipo). */
export default function PanelLayout<T extends string>({
  panelLabel, groups, active, onNavigate, user, title, sidebarSlot, headerRight, children,
}: PanelLayoutProps<T>) {
  return (
    <div className="h-screen bg-background flex overflow-hidden">
      <aside className="w-52 bg-[#18160F] flex flex-col py-4 flex-shrink-0 overflow-y-auto">
        <div className="flex items-center gap-2.5 px-4 mb-4">
          <BrandMark size={28} color="#E8700A" />
          <div>
            <p className="text-white font-display font-bold text-sm leading-none">{BRAND.name}</p>
            <p className="text-white/40 text-[10px] mt-0.5">{panelLabel}</p>
          </div>
        </div>
        {sidebarSlot}
        <nav className="flex flex-col flex-1 px-2">
          {groups.map((group, index) => (
            <div key={group.label ?? index} className={index > 0 ? 'mt-4' : ''}>
              {group.label && (
                <p className="text-white/30 text-[9px] font-bold uppercase tracking-widest px-3 mb-1">{group.label}</p>
              )}
              {group.items.map(({ id, icon: Icon, label, locked }) => (
                <button
                  key={id}
                  onClick={() => onNavigate(id)}
                  aria-current={active === id ? 'page' : undefined}
                  className={cn(
                    'w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-left text-sm transition-colors',
                    active === id ? 'bg-primary text-white font-medium' : 'text-white/60 hover:text-white hover:bg-white/10',
                  )}
                >
                  <Icon size={14} className="flex-shrink-0" />
                  <span className="flex-1">{label}</span>
                  {locked && <Lock size={11} className="flex-shrink-0 opacity-70" aria-label="Fora do plano" />}
                </button>
              ))}
            </div>
          ))}
        </nav>
        <div className="px-4 pt-4 border-t border-white/10 mt-4">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-full bg-primary/30 flex items-center justify-center flex-shrink-0">
              <span className="text-white text-[10px] font-bold">{getInitials(user.name)}</span>
            </div>
            <div className="min-w-0">
              <p className="text-white text-xs font-medium leading-none truncate">{user.name}</p>
              <p className="text-white/40 text-[10px] mt-0.5">{user.role}</p>
            </div>
          </div>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden min-w-0">
        <header className="bg-card border-b border-border px-6 py-3.5 flex-shrink-0 flex items-center justify-between gap-4">
          <div>
            <h1 className="font-display font-bold text-foreground text-lg leading-none">{title}</h1>
            <p className="text-xs text-muted-foreground mt-0.5">{formatDate(new Date())}</p>
          </div>
          {headerRight}
        </header>
        <main className="flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
}
