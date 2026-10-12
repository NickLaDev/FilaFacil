import { useState } from 'react';
import { BookOpen, Edit3, ImageOff, Plus, Search, Star, Trash2, X } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { useAsyncAction } from '@/lib/useAsyncAction';
import { cn, formatCurrency, formatDateTime } from '@/lib/utils';
import {
  deleteMenuItem,
  getCategories,
  setItemAvailability,
  recalculateRanking,
  setItemHighlight,
  useMenuRanking,
  useMenuItems,
  type MenuItemView,
} from '@/services/menuService';
import ConfirmDialog from '../../components/ConfirmDialog';
import type { ManagerSectionProps } from '../../types';
import MenuItemFormModal from './MenuItemFormModal';

const ALL_CATEGORIES = 'all';
const TOP_RANK_SIZE = 3;

/** Fichas 28, 03 e 46: cadastro do cardápio que o cliente vê, com destaque manual "+ pedido". */
export default function MenuSection({ unit, notify }: ManagerSectionProps) {
  const query = useMenuItems(unit.id);
  const items = query.data ?? [];
  const ranking = useMenuRanking(unit.id);
  const rankingById = new Map((ranking.data?.items ?? []).map(entry => [entry.menuItemId, entry]));
  const featuredIds = new Set(items.filter(item => item.highlighted).map(item => item.id));
  // Selo exibido ao cliente: destaque manual ou entre os mais vendidos (o servidor só lista quem vendeu).
  const badgeIds = new Set([...featuredIds, ...[...rankingById.values()].filter(entry => entry.quantity > 0 && entry.rank <= TOP_RANK_SIZE).map(entry => entry.menuItemId)]);
  const { run } = useAsyncAction(notify);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState(ALL_CATEGORIES);
  const [editing, setEditing] = useState<MenuItemView | 'new' | null>(null);
  const [deleting, setDeleting] = useState<MenuItemView | null>(null);

  const categories = getCategories(items);
  const filtered = items.filter(item => {
    const query = search.trim().toLowerCase();
    const matchesSearch = !query || item.name.toLowerCase().includes(query) || item.description.toLowerCase().includes(query);
    return matchesSearch && (category === ALL_CATEGORIES || item.category === category);
  });

  if (query.error) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <LoadingBlock />;

  return (
    <div className="p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">
          {items.length} {items.length === 1 ? 'item' : 'itens'} no cardápio · alterações aparecem na hora para o cliente
        </p>
        <div className="flex items-center gap-2">
          <button
            onClick={() => void run(() => recalculateRanking(unit.id), 'Ranking de vendas recalculado')}
            title={ranking.data?.calculatedAt ? `Último cálculo: ${formatDateTime(ranking.data.calculatedAt)}` : undefined}
            className="border border-border text-foreground px-4 py-2 rounded-xl text-sm font-medium hover:bg-muted"
          >
            Recalcular ranking
          </button>
          <button onClick={() => setEditing('new')} className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-medium">
            <Plus size={15} />
            Novo item
          </button>
        </div>
      </div>

      {items.length > 0 && (
        <div className="flex flex-col gap-3">
          <div className="relative max-w-md">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar no cardápio..."
              aria-label="Buscar no cardápio"
              className="w-full bg-card border border-border rounded-xl pl-9 pr-9 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2" aria-label="Limpar busca">
                <X size={14} className="text-muted-foreground" />
              </button>
            )}
          </div>
          <div className="flex gap-2 flex-wrap">
            {[ALL_CATEGORIES, ...categories].map(option => (
              <button
                key={option}
                onClick={() => setCategory(option)}
                className={cn(
                  'px-3 py-1.5 rounded-full text-sm font-medium transition-colors',
                  category === option ? 'bg-primary text-white' : 'bg-muted text-muted-foreground hover:text-foreground',
                )}
              >
                {option === ALL_CATEGORIES ? 'Todas' : option}
              </button>
            ))}
          </div>
          <p className="text-xs text-muted-foreground flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded-md">+ pedido</span>
            ranking de vendas dos últimos 30 dias (3 primeiros) + itens destacados manualmente com
            <Star size={12} className="fill-primary text-primary" />
          </p>
        </div>
      )}

      {items.length === 0 ? (
        <div className="bg-card rounded-xl border border-border">
          <EmptyState
            icon={BookOpen}
            title="Cardápio vazio"
            description={`${unit.name} ainda não tem itens. Cadastre o primeiro para ele aparecer para os clientes.`}
            action={
              <button onClick={() => setEditing('new')} className="bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-medium">
                Cadastrar item
              </button>
            }
          />
        </div>
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-x-auto">
          <table className="w-full min-w-[640px]">
            <thead className="bg-muted/50">
              <tr className="text-left text-xs text-muted-foreground uppercase tracking-wider">
                <th className="px-4 py-3">Item</th>
                <th className="px-4 py-3">Categoria</th>
                <th className="px-4 py-3">Preço</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Ações</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(item => (
                <tr key={item.id} className="border-t border-border hover:bg-muted/30 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      {item.image ? (
                        <img src={item.image} alt="" className={cn('w-10 h-10 rounded-lg object-cover bg-muted', !item.available && 'grayscale')} />
                      ) : (
                        <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center" aria-label="Sem foto">
                          <ImageOff size={14} className="text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="font-medium text-foreground text-sm">{item.name}</p>
                        {badgeIds.has(item.id) && (
                          <span className="text-[10px] font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded-md">+ pedido</span>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-muted-foreground">{item.category}</td>
                  <td className="px-4 py-3 font-display font-bold text-foreground text-sm">{formatCurrency(item.price)}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() =>
                        void run(
                          () => setItemAvailability(unit.id, item.id, !item.available),
                          `${item.name} ${item.available ? 'marcado como esgotado' : 'disponível de novo'}`,
                        )
                      }
                      title={item.available ? 'Marcar como esgotado' : 'Reativar item'}
                      className={cn('text-xs font-bold px-2.5 py-1 rounded-full', item.available ? 'bg-success-bg text-success' : 'bg-muted text-muted-foreground')}
                    >
                      {item.available ? 'Disponível' : 'Esgotado'}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button
                        onClick={() => void run(() => setItemHighlight(unit.id, item.id, !featuredIds.has(item.id)), featuredIds.has(item.id) ? 'Destaque removido' : `${item.name} destacado como "+ pedido"`)}
                        title={featuredIds.has(item.id) ? 'Remover destaque' : 'Destacar como "+ pedido"'}
                        aria-pressed={featuredIds.has(item.id)}
                        aria-label={`Destacar ${item.name}`}
                        className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground hover:text-primary"
                      >
                        <Star size={14} className={featuredIds.has(item.id) ? 'fill-primary text-primary' : ''} />
                      </button>
                      <button onClick={() => setEditing(item)} aria-label={`Editar ${item.name}`} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground hover:text-foreground">
                        <Edit3 size={14} />
                      </button>
                      <button onClick={() => setDeleting(item)} aria-label={`Excluir ${item.name}`} className="p-1.5 hover:bg-error-bg rounded-lg text-muted-foreground hover:text-error">
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    Nenhum item encontrado com esses filtros.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {editing && (
        <MenuItemFormModal
          establishmentId={unit.id}
          item={editing === 'new' ? undefined : editing}
          categories={categories}
          onClose={() => setEditing(null)}
          notify={notify}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Excluir item"
          message={`"${deleting.name}" sai do cardápio do cliente e das promoções em que estiver.`}
          confirmLabel="Excluir item"
          onConfirm={() => run(() => deleteMenuItem(unit.id, deleting.id), `${deleting.name} excluído do cardápio`)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
