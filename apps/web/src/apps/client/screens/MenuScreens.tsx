import { useState } from 'react';
import { ChevronLeft, Eye, Minus, Plus, Search, ShieldAlert, X } from 'lucide-react';
import { allergenLabel, restrictedAllergens } from '@filafacil/shared';
import BottomSheet from '@/components/ui/BottomSheet';
import { imageOrPlaceholder } from '@/lib/images';
import { cn, formatCurrency } from '@/lib/utils';
import EmptyState from '@/components/ui/EmptyState';
import { LoadingBlock } from '@/components/ui/QueryState';
import { usePublicMenu, useRestaurant, type PricedMenuItem } from '@/services/restaurantService';
import { useClient } from '../clientContext';
import { FixedBottom } from '../components/Layout';
import RestaurantUnavailable from '../components/RestaurantUnavailable';

const HIGHLIGHT_CATEGORY = 'Mais pedidos';
const QUICK_NOTES = ['Sem gelo', 'Sem cebola', 'Sem pimenta', 'Bem passado', 'Ao ponto', 'Mal passado'];

/** Cardápio do cliente com preço promocional vigente e itens esgotados ocultos (fichas 03, 19, 29, 46). */
function useClientMenu() {
  const { establishmentId, table } = useClient();
  const restaurant = useRestaurant(establishmentId);
  const establishment = restaurant.data ?? null;
  // A API só devolve itens disponíveis, com o preço vigente; mudanças chegam por WebSocket (ficha 19).
  const menu = usePublicMenu(establishmentId);
  const items = menu.data?.items ?? [];
  const canOrder = Boolean(establishment && table?.establishmentId === establishment.id && establishment.acceptingOrders);
  return { establishment, items, categories: menu.data?.categories ?? [], canOrder, table, error: restaurant.error ?? menu.error, retry: () => void Promise.all([restaurant.refetch(), menu.refetch()]) };
}

/** Alérgenos do item (ficha 64): os que o cliente marcou como restrição ficam em destaque. */
function AllergenTags({ item, restrictions, className }: { item: PricedMenuItem; restrictions: string[]; className?: string }) {
  if (item.allergens.length === 0) return null;
  const blocked = new Set(restrictedAllergens(item.allergens, restrictions));
  return (
    <div className={cn('flex flex-wrap gap-1', className)} data-testid="allergen-tags">
      {item.allergens.map(key => (
        <span key={key} data-restricted={blocked.has(key as never) || undefined} className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded-md', blocked.has(key as never) ? 'bg-error text-white' : 'bg-muted text-muted-foreground')}>
          {blocked.has(key as never) && '⚠ '}{allergenLabel(key)}
        </span>
      ))}
    </div>
  );
}

function PriceTag({ item, className }: { item: PricedMenuItem; className?: string }) {
  return (
    <div className={cn('flex items-baseline gap-1.5', className)}>
      <span className="font-display font-bold text-foreground">{formatCurrency(item.finalPrice)}</span>
      {item.promotion && <span className="text-xs text-muted-foreground line-through">{formatCurrency(item.price)}</span>}
    </div>
  );
}

export function MenuScreen() {
  const { go, cart, openItem, account } = useClient();
  const { establishment, items, categories: menuCategories, canOrder, table, error, retry } = useClientMenu();
  const restrictions = account?.dietaryRestrictions ?? [];
  const [category, setCategory] = useState(HIGHLIGHT_CATEGORY);
  const [query, setQuery] = useState('');

  if (error) return <RestaurantUnavailable error={error} onRetry={retry} onExplore={() => go('explore')} />;
  if (!establishment) return <LoadingBlock className="min-h-screen" />;
  const categories = [HIGHLIGHT_CATEGORY, ...menuCategories];
  const search = query.trim().toLowerCase();
  const visible = items.filter(item =>
    search
      ? `${item.name} ${item.description}`.toLowerCase().includes(search)
      : category === HIGHLIGHT_CATEGORY ? item.topSeller : item.category === category,
  );
  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const cartTotal = cart.reduce((sum, line) => sum + (items.find(i => i.id === line.itemId)?.finalPrice ?? 0) * line.quantity, 0);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="bg-card border-b border-border px-4 pt-4 pb-3 sticky top-0 z-10">
        {canOrder && table && (
          <div className="flex items-center gap-2 mb-2">
            <div className="w-1.5 h-1.5 rounded-full bg-success" />
            <p className="text-xs text-muted-foreground">{establishment.name} · {table.tableLabel}</p>
          </div>
        )}
        <div className="flex items-center gap-3 mb-3">
          <button onClick={() => go(canOrder ? 'home-in-bar' : 'restaurant-detail')} className="p-1.5 -ml-1.5 hover:bg-muted rounded-lg transition-colors" aria-label="Voltar">
            <ChevronLeft size={20} className="text-foreground" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="font-display font-bold text-foreground">Cardápio</h1>
            {!canOrder && <p className="text-xs text-muted-foreground truncate">{establishment.name}</p>}
          </div>
        </div>
        <div className="relative mb-3">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Buscar no cardápio..."
            aria-label="Buscar no cardápio"
            className="w-full bg-muted border-0 rounded-xl pl-9 pr-4 py-2.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary"
          />
          {query && (
            <button onClick={() => setQuery('')} className="absolute right-3 top-1/2 -translate-y-1/2" aria-label="Limpar busca">
              <X size={14} className="text-muted-foreground" />
            </button>
          )}
        </div>
        {!search && (
          <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
            {categories.map(name => (
              <button
                key={name}
                onClick={() => setCategory(name)}
                className={cn('flex-shrink-0 px-3.5 py-1.5 rounded-full text-sm font-medium transition-colors',
                  category === name ? 'bg-primary text-primary-foreground' : 'bg-muted text-muted-foreground hover:text-foreground')}
              >
                {name}
              </button>
            ))}
          </div>
        )}
      </div>

      {!canOrder && (
        <div className="mx-4 mt-4 bg-primary/5 border border-primary/20 rounded-xl px-4 py-3 flex items-start gap-2">
          <Eye size={15} className="text-primary flex-shrink-0 mt-0.5" />
          <p className="text-xs text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Somente consulta.</strong> Para pedir, escaneie o QR Code da mesa com o estabelecimento aberto.
          </p>
        </div>
      )}

      <div className="flex-1 px-4 py-4 pb-40 flex flex-col gap-3">
        {items.length === 0 ? (
          <EmptyState icon={Search} title="Cardápio ainda não publicado" description="Este estabelecimento ainda não cadastrou itens." />
        ) : visible.length === 0 ? (
          <EmptyState icon={Search} title="Nenhum item encontrado" />
        ) : visible.map(item => (
          <button
            key={item.id}
            onClick={() => openItem(item.id)}
            className="bg-card rounded-xl border border-border flex gap-3 p-3 text-left transition-all hover:border-primary/30 active:scale-99"
          >
            <div className="relative w-24 h-24 flex-shrink-0">
              <img src={imageOrPlaceholder(item.image)} alt={item.name} className="w-full h-full object-cover rounded-lg bg-muted" />
              {item.topSeller && (
                <span className="absolute -top-1.5 -left-1.5 bg-primary text-primary-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-md">+ pedido</span>
              )}
              {item.promotion && (
                <span className="absolute -bottom-1.5 -left-1.5 bg-secondary text-secondary-foreground text-[10px] font-bold px-1.5 py-0.5 rounded-md max-w-[110px] truncate">
                  {item.promotion.name} -{item.promotion.discountPercent}%
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0 flex flex-col justify-between">
              <div>
                <p className="font-display font-semibold text-foreground text-sm leading-tight">{item.name}</p>
                <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{item.description}</p>
                <AllergenTags item={item} restrictions={restrictions} className="mt-1.5" />
              </div>
              <div className="flex items-center justify-between mt-2">
                <PriceTag item={item} />
                {canOrder && (
                  <div className="w-7 h-7 rounded-lg bg-primary/10 flex items-center justify-center">
                    <Plus size={14} className="text-primary" />
                  </div>
                )}
              </div>
            </div>
          </button>
        ))}
      </div>

      {canOrder && cartCount > 0 && (
        <FixedBottom aboveNav>
          <button onClick={() => go('cart')} className="w-full bg-primary text-primary-foreground flex items-center justify-between px-5 py-4 rounded-xl shadow-lg">
            <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center">
              <span className="text-sm font-bold">{cartCount}</span>
            </div>
            <span className="font-display font-semibold">Ver carrinho</span>
            <span className="font-display font-bold">{formatCurrency(cartTotal)}</span>
          </button>
        </FixedBottom>
      )}
    </div>
  );
}

export function ItemDetailScreen() {
  const { go, selectedItemId, addToCart, showToast, account } = useClient();
  const { establishment, items, canOrder } = useClientMenu();
  const [quantity, setQuantity] = useState(1);
  const [confirmRestricted, setConfirmRestricted] = useState(false);
  const [notes, setNotes] = useState('');
  const item = items.find(i => i.id === selectedItemId);

  if (!establishment) return <LoadingBlock className="min-h-screen" />;
  if (!item) {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <EmptyState
          icon={X}
          title="Item indisponível"
          description="Este item acabou de ficar indisponível."
          action={<button onClick={() => go('menu')} className="bg-primary text-primary-foreground px-6 py-3 rounded-xl font-medium mt-2">Voltar ao cardápio</button>}
        />
      </div>
    );
  }

  const restrictions = account?.dietaryRestrictions ?? [];
  const conflicts = item ? restrictedAllergens(item.allergens, restrictions) : [];

  /** Ficha 64: item com algo que o cliente não pode comer exige confirmação antes de entrar no carrinho. */
  function handleAdd(confirmed = false) {
    if (!item || !establishment) return;
    if (conflicts.length > 0 && !confirmed) {
      setConfirmRestricted(true);
      return;
    }
    addToCart(establishment.id, { itemId: item.id, quantity, notes: notes.trim(), name: item.name, image: item.image });
    showToast('Adicionado ao pedido');
    go('menu');
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="relative h-64 flex-shrink-0">
        <img src={imageOrPlaceholder(item.image)} alt={item.name} className="w-full h-full object-cover" />
        <button onClick={() => go('menu')} className="absolute top-4 left-4 w-9 h-9 rounded-full bg-black/40 flex items-center justify-center backdrop-blur-sm" aria-label="Voltar">
          <ChevronLeft size={18} className="text-white" />
        </button>
        {item.topSeller && (
          <span className="absolute top-4 right-4 bg-primary text-primary-foreground text-xs font-bold px-3 py-1 rounded-full">Mais pedido</span>
        )}
      </div>
      <div className="flex-1 flex flex-col px-5 py-5 gap-5 pb-40">
        <div>
          <h1 className="font-display text-xl font-bold text-foreground">{item.name}</h1>
          <p className="text-muted-foreground text-sm mt-1">{item.description}</p>
          <AllergenTags item={item} restrictions={restrictions} className="mt-2" />
        </div>
        {conflicts.length > 0 && (
          <div role="alert" data-testid="allergen-warning" className="flex items-start gap-2 bg-error-bg border border-error/30 rounded-xl px-4 py-3">
            <ShieldAlert size={16} className="text-error flex-shrink-0 mt-0.5" />
            <p className="text-sm text-error"><strong>Atenção:</strong> este item contém {conflicts.map(allergenLabel).join(', ')}, que você marcou como restrição.</p>
          </div>
        )}
        <div>
          <PriceTag item={item} className="[&>span:first-child]:text-2xl" />
          {item.promotion && (
            <p className="text-xs text-secondary font-semibold mt-1">{item.promotion.name}: -{item.promotion.discountPercent}%</p>
          )}
        </div>
        {canOrder && (
          <>
            <div>
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3">Observações rápidas</p>
              <div className="flex flex-wrap gap-2">
                {QUICK_NOTES.map(note => (
                  <button
                    key={note}
                    onClick={() => setNotes(notes === note ? '' : note)}
                    className={cn('px-3 py-1.5 rounded-full text-sm border transition-colors',
                      notes === note ? 'border-primary bg-primary/10 text-primary font-medium' : 'border-border text-muted-foreground hover:border-foreground')}
                  >
                    {note}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label htmlFor="item-notes" className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2 block">Alguma observação?</label>
              <textarea
                id="item-notes"
                value={notes}
                onChange={event => setNotes(event.target.value.slice(0, 140))}
                placeholder="Ex: sem gelo, ponto da carne..."
                rows={2}
                className="w-full bg-muted rounded-xl px-4 py-3 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary resize-none"
              />
            </div>
          </>
        )}
      </div>
      {confirmRestricted && (
        <BottomSheet onClose={() => setConfirmRestricted(false)}>
          <div className="flex flex-col items-center text-center gap-3">
            <div className="w-14 h-14 rounded-2xl bg-error-bg flex items-center justify-center"><ShieldAlert size={28} className="text-error" /></div>
            <p className="font-display font-bold text-foreground text-lg">Este item pode não ser seguro para você</p>
            <p data-testid="allergen-confirm" className="text-sm text-muted-foreground">Contém {conflicts.map(allergenLabel).join(', ')}, que você marcou como restrição. Quer adicionar mesmo assim?</p>
            <button onClick={() => setConfirmRestricted(false)} className="w-full bg-primary text-primary-foreground font-display font-semibold py-3.5 rounded-xl">Não adicionar</button>
            <button onClick={() => { setConfirmRestricted(false); handleAdd(true); }} data-testid="allergen-add-anyway" className="text-error text-sm font-medium py-2">Adicionar mesmo assim</button>
          </div>
        </BottomSheet>
      )}
      {canOrder && (
        <FixedBottom aboveNav className="flex items-center gap-3">
          <div className="flex items-center gap-3 bg-card border border-border rounded-xl px-4 py-3">
            <button onClick={() => setQuantity(q => Math.max(1, q - 1))} className="text-primary" aria-label="Diminuir quantidade"><Minus size={16} /></button>
            <span className="font-display font-bold text-foreground w-5 text-center">{quantity}</span>
            <button onClick={() => setQuantity(q => Math.min(20, q + 1))} className="text-primary" aria-label="Aumentar quantidade"><Plus size={16} /></button>
          </div>
          <button onClick={() => handleAdd()} data-testid="add-to-cart" className="flex-1 bg-primary text-primary-foreground font-display font-semibold py-3 rounded-xl text-sm">
            Adicionar · {formatCurrency(item.finalPrice * quantity)}
          </button>
        </FixedBottom>
      )}
    </div>
  );
}
