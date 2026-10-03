import { cn } from '@/lib/utils';
import type { ClientScreen } from '../types';
import { TABS_GLOBAL, TABS_IN_BAR } from '../navigation';

interface BottomNavProps {
  activeScreen: ClientScreen;
  onNavigate: (screen: ClientScreen) => void;
  hasActiveOrder: boolean;
  inBar: boolean;
}

export default function BottomNav({ activeScreen, onNavigate, hasActiveOrder, inBar }: BottomNavProps) {
  const tabs = inBar ? TABS_IN_BAR : TABS_GLOBAL;
  const activeTab = tabs.find(tab => tab.screens.includes(activeScreen))?.id;

  return (
    <nav className="fixed bottom-0 left-1/2 -translate-x-1/2 w-full max-w-[390px] bg-card border-t border-border z-30">
      <div className="flex">
        {tabs.map(({ id, label, icon: Icon, destination }) => {
          const isActive = id === activeTab;
          return (
            <button
              key={id}
              onClick={() => onNavigate(destination)}
              aria-current={isActive ? 'page' : undefined}
              className="flex-1 flex flex-col items-center gap-1 py-3 relative"
            >
              <div className="relative">
                <Icon size={20} className={isActive ? 'text-primary' : 'text-muted-foreground'} />
                {id === 'orders' && hasActiveOrder && !isActive && (
                  <div className="absolute -top-0.5 -right-0.5 w-2 h-2 rounded-full bg-primary" />
                )}
              </div>
              <span className={cn('text-[10px] font-medium', isActive ? 'text-primary' : 'text-muted-foreground')}>{label}</span>
              {isActive && <div className="absolute top-0 left-1/2 -translate-x-1/2 w-8 h-0.5 rounded-full bg-primary" />}
            </button>
          );
        })}
      </div>
    </nav>
  );
}
