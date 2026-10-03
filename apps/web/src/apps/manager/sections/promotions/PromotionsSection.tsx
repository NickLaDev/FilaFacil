import { useState } from 'react';
import { Edit3, Plus, Tag, Trash2 } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import { useNow } from '@/lib/hooks';
import { cn, formatDateTime } from '@/lib/utils';
import { deletePromotion, getPromotionState, useMenuItems, usePromotions } from '@/services/menuService';
import type { Promotion, PromotionState } from '@/types/catalog';
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
  const promotions = usePromotions(unit.id);
  const items = useMenuItems(unit.id);
  const now = useNow(30_000);
  const [editing, setEditing] = useState<Promotion | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Promotion | null>(null);

  const itemName = (id: string) => items.find(i => i.id === id)?.name;
  const sorted = [...promotions].sort(
    (a, b) => STATE_ORDER.indexOf(getPromotionState(a, now)) - STATE_ORDER.indexOf(getPromotionState(b, now)) || Date.parse(a.startsAt) - Date.parse(b.startsAt),
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
            const state = getPromotionState(promotion, now);
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
          onSaved={notify}
        />
      )}
      {deleting && (
        <ConfirmDialog
          title="Excluir promoção"
          message={`"${deleting.name}" deixa de valer imediatamente no cardápio do cliente.`}
          confirmLabel="Excluir promoção"
          onConfirm={() => {
            deletePromotion(deleting.id);
            notify(`Promoção ${deleting.name} excluída`);
          }}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}
