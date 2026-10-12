import { useState } from 'react';
import { BarChart2, Code2, Monitor, RotateCcw, Shield, Smartphone, X } from 'lucide-react';
import { resetPersistentStores } from '@/lib/store';
import { cn } from '@/lib/utils';
import type { Profile } from '@/app/profiles';

const PROFILES: { id: Profile; icon: typeof Smartphone; label: string; sub: string }[] = [
  { id: 'client', icon: Smartphone, label: 'Cliente', sub: 'Mobile' },
  { id: 'attendant', icon: Monitor, label: 'Atendente', sub: 'Tablet' },
  { id: 'manager', icon: BarChart2, label: 'Gestor', sub: 'Painel' },
  { id: 'admin', icon: Shield, label: 'Admin', sub: 'Plataforma' },
];

interface Props {
  active: Profile;
  onChange: (profile: Profile) => void;
}

/**
 * Atalho de desenvolvimento para alternar entre os apps (só existe com `pnpm dev`).
 * Em produção cada perfil é acessado pela própria URL.
 */
export default function DevProfileSwitcher({ active, onChange }: Props) {
  const [open, setOpen] = useState(false);

  /** Preferências locais do aparelho (região, atalho de biometria); os dados da API voltam ao seed com `pnpm db:seed`. */
  function resetDemoData() {
    resetPersistentStores();
    window.location.reload();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="fixed bottom-3 right-3 z-[70] flex items-center gap-1.5 bg-[#18160F]/90 text-white/80 hover:text-white text-[11px] font-semibold px-3 py-2 rounded-full shadow-xl border border-white/10 backdrop-blur-md"
        title="Ferramentas de desenvolvimento"
      >
        <Code2 size={13} />
        DEV
      </button>
    );
  }

  return (
    <div className="fixed bottom-3 right-3 z-[70] bg-[#18160F]/95 backdrop-blur-md rounded-2xl p-2 shadow-xl border border-white/10 w-52">
      <div className="flex items-center justify-between px-2 pb-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-white/40">Dev · perfis</span>
        <button onClick={() => setOpen(false)} className="text-white/50 hover:text-white" aria-label="Fechar">
          <X size={14} />
        </button>
      </div>
      <div className="flex flex-col gap-1">
        {PROFILES.map(({ id, icon: Icon, label, sub }) => (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={cn(
              'flex items-center gap-2.5 px-3 py-2 rounded-xl transition-all text-left',
              active === id ? 'bg-primary text-white' : 'text-white/60 hover:text-white hover:bg-white/10',
            )}
          >
            <Icon size={15} />
            <div>
              <p className="text-xs font-display font-semibold leading-none">{label}</p>
              <p className={cn('text-[10px] leading-none mt-0.5', active === id ? 'text-white/70' : 'text-white/40')}>{sub}</p>
            </div>
          </button>
        ))}
      </div>
      <button
        onClick={resetDemoData}
        className="mt-2 w-full flex items-center justify-center gap-1.5 text-[11px] text-white/50 hover:text-white border-t border-white/10 pt-2"
      >
        <RotateCcw size={11} />
        Limpar dados locais
      </button>
    </div>
  );
}
