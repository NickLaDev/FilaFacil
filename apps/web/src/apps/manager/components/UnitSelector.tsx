import { useState } from 'react';
import { Check, ChevronDown } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ManagerUnit } from '../types';

interface UnitSelectorProps {
  units: ManagerUnit[];
  activeId: string;
  onSelect: (id: string) => void;
}

/** Troca a unidade da organização sobre a qual todo o painel opera. */
export default function UnitSelector({ units, activeId, onSelect }: UnitSelectorProps) {
  const [open, setOpen] = useState(false);
  const active = units.find(u => u.id === activeId);

  return (
    <div className="mx-2 mb-3 relative">
      <button
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className="w-full flex items-center gap-2 bg-white/10 hover:bg-white/15 rounded-lg px-3 py-2 transition-colors"
      >
        <div className={cn('w-2 h-2 rounded-full flex-shrink-0', active?.status === 'active' ? 'bg-success' : 'bg-muted-foreground')} />
        <span className="text-white text-xs font-medium flex-1 text-left leading-tight truncate">{active?.name ?? 'Unidade'}</span>
        <ChevronDown size={12} className="text-white/40 flex-shrink-0" />
      </button>
      {open && (
        <div role="listbox" className="absolute top-full left-0 right-0 mt-1 bg-[#2a2720] rounded-lg overflow-hidden z-20 shadow-xl">
          {units.map(unit => (
            <button
              key={unit.id}
              role="option"
              aria-selected={unit.id === activeId}
              onClick={() => {
                onSelect(unit.id);
                setOpen(false);
              }}
              className={cn('w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-white/10 transition-colors', unit.id === activeId && 'bg-white/10')}
            >
              <div className={cn('w-2 h-2 rounded-full flex-shrink-0', unit.status === 'active' ? 'bg-success' : 'bg-muted-foreground')} />
              <div className="flex-1 min-w-0">
                <p className="text-white text-xs font-medium leading-tight truncate">{unit.name}</p>
                <p className="text-white/40 text-[10px] truncate">{unit.status === 'active' ? unit.address : unit.status === 'suspended' ? 'Suspensa' : 'Inativa'}</p>
              </div>
              {unit.id === activeId && <Check size={11} className="text-primary flex-shrink-0" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
