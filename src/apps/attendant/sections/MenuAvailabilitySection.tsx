import { useMemo, useState } from 'react';
import { BookOpen, History, Search, X } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import Toggle from '@/components/ui/Toggle';
import { cn, formatDateTime } from '@/lib/utils';
import { getCategories, setItemAvailability, useAvailabilityLog, useMenuItems } from '@/services/menuService';

interface Props {
  establishmentId: string;
  actorName: string;
}

/** Ficha 19: item esgotado some do cardápio do cliente e cada mudança fica no histórico. */
export default function MenuAvailabilitySection({ establishmentId, actorName }: Props) {
  const items = useMenuItems(establishmentId);
  const log = useAvailabilityLog(establishmentId);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query ? items.filter(i => i.name.toLowerCase().includes(query) || i.category.toLowerCase().includes(query)) : items;
  }, [items, search]);
  const categories = getCategories(filtered);
  const unavailableCount = items.filter(i => !i.available).length;

  return (
    <div className="flex-1 overflow-auto p-5">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px] max-w-5xl">
        <div className="min-w-0">
          <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
            <p className="text-sm text-muted-foreground">Alterações refletem imediatamente no cardápio do cliente.</p>
            {unavailableCount > 0 && (
              <span className="text-xs font-bold bg-muted text-muted-foreground px-2.5 py-1 rounded-full">
                {unavailableCount} esgotado{unavailableCount > 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="relative mb-4">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar item ou categoria..."
              aria-label="Buscar item"
              className="w-full bg-card border border-border rounded-xl pl-9 pr-9 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2" aria-label="Limpar busca">
                <X size={14} className="text-muted-foreground" />
              </button>
            )}
          </div>

          {filtered.length === 0 ? (
            <EmptyState icon={BookOpen} title="Nenhum item encontrado" description={items.length ? 'Tente outro termo de busca.' : 'O gestor ainda não cadastrou itens no cardápio.'} />
          ) : (
            <div className="flex flex-col gap-5">
              {categories.map(category => (
                <div key={category}>
                  <p className="text-xs font-bold uppercase tracking-widest text-muted-foreground mb-2">{category}</p>
                  <div className="flex flex-col gap-2">
                    {filtered
                      .filter(i => i.category === category)
                      .map(item => (
                        <div key={item.id} className="bg-card rounded-xl border border-border px-4 py-3.5 flex items-center justify-between gap-3">
                          <div className="flex items-center gap-3 min-w-0">
                            <img src={item.image} alt="" className={cn('w-10 h-10 rounded-lg object-cover bg-muted flex-shrink-0', !item.available && 'grayscale')} />
                            <p className="font-medium text-foreground text-sm truncate">{item.name}</p>
                          </div>
                          <div className="flex items-center gap-3 flex-shrink-0">
                            <span className={cn('text-xs font-medium', item.available ? 'text-success' : 'text-muted-foreground')}>
                              {item.available ? 'Disponível' : 'Esgotado'}
                            </span>
                            <Toggle
                              checked={item.available}
                              onChange={available => setItemAvailability(item.id, available, actorName)}
                              label={`${item.name}: ${item.available ? 'marcar como esgotado' : 'reativar'}`}
                              tone="success"
                            />
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <aside className="bg-card border border-border rounded-xl overflow-hidden self-start">
          <div className="px-4 py-3 border-b border-border flex items-center gap-2">
            <History size={14} className="text-muted-foreground" />
            <p className="font-semibold text-foreground text-sm">Histórico de alterações</p>
          </div>
          {log.length === 0 ? (
            <p className="text-sm text-muted-foreground px-4 py-6 text-center">Nenhuma alteração registrada.</p>
          ) : (
            <ul className="max-h-[480px] overflow-y-auto">
              {log.map(entry => (
                <li key={entry.id} className="px-4 py-3 border-b border-border last:border-0">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-foreground truncate">{entry.itemName}</p>
                    <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full flex-shrink-0', entry.available ? 'bg-success-bg text-success' : 'bg-muted text-muted-foreground')}>
                      {entry.available ? 'Reativado' : 'Esgotado'}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {entry.actor} · {formatDateTime(Date.parse(entry.at))}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </aside>
      </div>
    </div>
  );
}
