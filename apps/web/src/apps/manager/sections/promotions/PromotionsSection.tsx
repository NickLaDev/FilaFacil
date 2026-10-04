import { useState } from 'react';
import { Edit3, Plus, Tag, Trash2 } from 'lucide-react';
import type { PromotionDto, PromotionState } from '@filafacil/shared';
import EmptyState from '@/components/ui/EmptyState';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { useAsyncAction } from '@/lib/useAsyncAction';
import { cn, formatDateTime } from '@/lib/utils';
import { useMenuItems } from '@/services/menuService';
import { deletePromotion, usePromotions } from '@/services/promotionService';
import ConfirmDialog from '../../components/ConfirmDialog';
import type { ManagerSectionProps } from '../../types';
import PromotionFormModal from './PromotionFormModal';

const STATE_BADGE: Record<PromotionState, { label: string; className: string }> = {
  active: { label: 'Ativa', className: 'bg-success-bg text-success' },
  scheduled: { label: 'Agendada', className: 'bg-warning-bg text-warning' },
  expired: { label: 'Encerrada', className: 'bg-muted text-muted-foreground' },
};

const STATE_ORDER: PromotionState[] = ['active', 'scheduled', 'expired'];

/** Ficha 29: o período define quando a promoção entra e sai do cardápio do cliente. */
export default function PromotionsSection({ unit, notify }: ManagerSectionProps) {
  const promotionsQuery = usePromotions(unit.id);
  const itemsQuery = useMenuItems(unit.id);
  const items = itemsQuery.data ?? [];
  const { run } = useAsyncAction(notify);
  const [editing, setEditing] = useState<PromotionDto | 'new' | null>(null);
  const [deleting, setDeleting] = useState<PromotionDto | null>(null);

  if (promotionsQuery.error) return <ErrorBlock error={promotionsQuery.error} onRetry={() => void promotionsQuery.refetch()} />;
  if (!promotionsQuery.data || !itemsQuery.data) return <LoadingBlock />;

  const itemName = (id: string) => items.find(i => i.id === id)?.name;
  // O status vem do servidor (derivado do período); a ordem destaca as ativas.
  const sorted = [...promotionsQuery.data].sort(
    (a, b) => STATE_ORDER.indexOf(a.state) - STATE_ORDER.indexOf(b.state) || Date.parse(a.startsAt) - Date.parse(b.startsAt),
  );

  return (
    <div className="p-6 flex flex-col gap-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <p className="text-sm text-muted-foreground">O desconto aparece no cardápio do cliente durante o período e sai sozinho ao expirar.</p>
        <button
          onClick={() => setEditing('new')}
          disabled={items.length === 0}
          title={items.length === 0 ? 'Cadastre itens no cardápio primeiro' : undefined}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-medium disabled:opacity-50"
        >
          <Plus size={15} />
          Nova promoção
        </button>
      </div>

      {sorted.length === 0 ? (
        <div className="bg-card rounded-xl border border-border">
          <EmptyState icon={Tag} title="Nenhuma promoção" description="Crie descontos por período para atrair clientes nos horários de menor movimento." />
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {sorted.map(promotion => {
            const state = promotion.state;
            const names = promotion.itemIds.map(itemName).filter(Boolean);
            return (
              <div key={promotion.id} className={cn('bg-card rounded-xl border border-border p-5 flex items-center justify-between gap-4', state === 'expired' && 'opacity-60')}>
                <div className="flex flex-col gap-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="font-display font-semibold text-foreground">{promotion.name}</p>
                    <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full', STATE_BADGE[state].className)}>{STATE_BADGE[state].label}</span>
                  </div>
                  <p className="text-sm text-muted-foreground truncate">
                    {names.length ? names.join(', ') : 'Nenhum item vinculado'} · -{promotion.discountPercent}%
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatDateTime(Date.parse(promotion.startsAt))} até {formatDateTime(Date.parse(promotion.endsAt))}
                  </p>
                </div>
                <div className="flex gap-2 flex-shrink-0">
                  <button onClick={() => setEditing(promotion)} aria-label={`Editar ${promotion.name}`} className="p-2 hover:bg-muted rounded-lg text-muted-foreground">
                    <Edit3 size={15} />
                  </button>
                  <button onClick={() => setDeleting(promotion)} aria-label={`Excluir ${promotion.name}`} className="p-2 hover:bg-error-bg rounded-lg text-muted-foreground hover:text-error">
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {editing && (
        <PromotionFormModal
          establishmentId={unit.id}
          promotion={editing === 'new' ? undefined : editing}
          items={items}
          onClose={() => setEditing(null)}
          notify={notify}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Excluir promoção"
          message={`"${deleting.name}" deixa de valer imediatamente no cardápio do cliente.`}
          confirmLabel="Excluir promoção"
          onConfirm={() => run(() => deletePromotion(unit.id, deleting.id), `Promoção ${deleting.name} excluída`)}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
