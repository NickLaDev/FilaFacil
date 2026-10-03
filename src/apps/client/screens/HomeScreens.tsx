import { useMemo, useState } from 'react';
import { AlertCircle, ChevronRight, Clock, LogOut, MapPin, QrCode, Search, Star } from 'lucide-react';
import { cn, formatCurrency, getInitials } from '@/lib/utils';
import { useNow } from '@/lib/hooks';
import { BrandBadge } from '@/components/brand/Logo';
import BottomSheet from '@/components/ui/BottomSheet';
import { isAccountVerified } from '@/services/authService';
import { useEstablishment, usePublicEstablishments } from '@/services/establishmentService';
import { useClientLocation } from '@/services/deviceService';
import { usePricedMenu } from '@/services/menuService';
import { ORDER_STEPS } from '@/services/orderService';
import type { Establishment } from '@/types/establishment';
import type { Order, OrderStatus } from '@/types/order';
import { useClient } from '../clientContext';
import { useClientOrders } from '../hooks/useOrders';
import { StatusBadge } from '../components/RestaurantCard';
import VerificationBanner from '../components/VerificationBanner';
import { formatDistance } from '../format';

function Avatar() {
  const { go, account, isVisitor } = useClient();
  return (
    <button onClick={() => go('profile')} className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center" aria-label="Perfil">
      <span className="font-display font-bold text-primary text-sm">{account ? getInitials(account.name) : isVisitor ? 'V' : '?'}</span>
    </button>
  );
}

function ActiveOrderCard({ order, status }: { order: Order; status: OrderStatus }) {
  const { openOrder } = useClient();
  const stepLabel = ORDER_STEPS.find(step => step.status === status)?.label;
  return (
    <button onClick={() => openOrder(order.id, 'order-tracking')} className="w-full bg-card border-2 border-primary/25 rounded-xl p-4 text-left">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
            <span className="text-xs font-semibold text-primary uppercase tracking-wide">Pedido em andamento</span>
          </div>
          <p className="font-display font-bold text-foreground">Pedido #{order.number}</p>
          <p className="text-xs text-muted-foreground mt-0.5">{order.establishmentName} · {stepLabel}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-muted-foreground">Retirada</p>
          <p className="font-display font-bold text-foreground text-sm">{order.pickupPoint}</p>
        </div>
      </div>
      <div className="mt-3 bg-primary/8 rounded-lg px-3 py-2 flex items-center justify-between">
        <span className="text-primary text-sm font-medium">Acompanhar pedido</span>
        <ChevronRight size={15} className="text-primary" />
      </div>
    </button>
  );
}


function RestaurantMiniCard({ restaurant: r, onPress }: { restaurant: Establishment; onPress: () => void }) {
  const closed = r.orderingStatus === 'closed';
  return (
    <button onClick={onPress} className={cn('flex-shrink-0 w-44 bg-card border border-border rounded-xl overflow-hidden text-left', closed && 'opacity-75')}>
      <div className="relative h-24">
        <img src={r.images[0]} alt={r.name} className={cn('w-full h-full object-cover bg-muted', closed && 'grayscale')} />
        {r.highDemand && !closed && (
          <span className="absolute bottom-1.5 left-1.5 text-[9px] font-bold bg-warning text-white px-1.5 py-0.5 rounded-full">Alta demanda</span>
        )}
      </div>
      <div className="p-3">
        <p className="font-display font-semibold text-foreground text-xs leading-tight line-clamp-1">{r.name}</p>
        <div className="flex items-center gap-1.5 mt-1">
          {r.ratingCount > 0 && (
            <>
              <Star size={10} className="fill-primary text-primary" />
              <span className="text-[10px] text-muted-foreground">{r.rating} ·</span>
            </>
          )}
          <span className="text-[10px] text-muted-foreground">{formatDistance(r.distanceM)}</span>
        </div>
        <div className="mt-1.5">
          <StatusBadge status={r.orderingStatus} highDemand={r.highDemand} size="2xs" />
        </div>
        {!closed && <p className="text-[10px] text-muted-foreground mt-1">Espera: {r.avgTime}</p>}
      </div>
    </button>
  );
}

export function HomeOutOfBarScreen() {
  const { go, account, openEstablishment, openOrder } = useClient();
  const establishments = usePublicEstablishments();
  const location = useClientLocation();
  const { orders, active } = useClientOrders();
  const firstName = account?.name.split(' ')[0];

  const nearby = useMemo(() => [...establishments].sort((a, b) => a.distanceM - b.distanceM), [establishments]);
  const favorites = establishments.filter(e => account?.favoriteEstablishmentIds.includes(e.id));
  const pastOrders = orders.filter(entry => entry.status === 'delivered').slice(0, 2);

  return (
    <div className="min-h-screen bg-background flex flex-col pb-24">
      <div className="bg-card border-b border-border px-5 pt-5 pb-4">
        <div className="flex items-center justify-between mb-1">
          <BrandBadge />
          <Avatar />
        </div>
        <div className="mt-3">
          <h1 className="font-display font-bold text-foreground text-xl">Olá{firstName ? `, ${firstName}` : ''}!</h1>
          <button onClick={() => go('location')} className="flex items-center gap-1 text-muted-foreground text-sm mt-0.5 hover:text-foreground transition-colors">
            <MapPin size={12} />
            <span>{location.label}</span>
            <ChevronRight size={12} />
          </button>
        </div>
        <button onClick={() => go('explore')} className="mt-3 w-full relative text-left">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <span className="block w-full bg-muted rounded-xl pl-9 pr-4 py-2.5 text-sm text-muted-foreground">Buscar restaurante...</span>
        </button>
      </div>

      <div className="flex-1 flex flex-col">
        {account && !isAccountVerified(account) && (
          <div className="px-4 pt-4">
            <VerificationBanner returnTo="home-out-of-bar" />
          </div>
        )}

        {active && (
          <div className="px-4 pt-4">
            <ActiveOrderCard order={active.order} status={active.status} />
          </div>
        )}

        <div className="px-4 pt-4">
          <button onClick={() => go('qr-scanner')} className="w-full bg-foreground rounded-xl px-4 py-4 flex items-center gap-4 text-left">
            <div className="w-11 h-11 rounded-xl bg-primary flex items-center justify-center flex-shrink-0">
              <QrCode size={22} className="text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-display font-semibold text-white text-sm">Já está no local?</p>
              <p className="text-white/50 text-xs mt-0.5">Escaneie o QR Code da mesa para pedir</p>
            </div>
            <ChevronRight size={16} className="text-white/40 flex-shrink-0" />
          </button>
        </div>

        <div className="pt-5">
          <div className="flex items-center justify-between px-4 mb-3">
            <p className="font-display font-semibold text-foreground text-sm">Perto de você</p>
            <button onClick={() => go('explore')} className="text-primary text-xs font-medium">Ver todos</button>
          </div>
          <div className="flex gap-3 overflow-x-auto px-4 pb-1">
            {nearby.map(r => <RestaurantMiniCard key={r.id} restaurant={r} onPress={() => openEstablishment(r.id)} />)}
          </div>
        </div>

        {favorites.length > 0 && (
          <div className="pt-5">
            <div className="flex items-center justify-between px-4 mb-3">
              <p className="font-display font-semibold text-foreground text-sm">Seus favoritos</p>
              <button onClick={() => go('favorites')} className="text-primary text-xs font-medium">Ver todos</button>
            </div>
            <div className="flex gap-3 overflow-x-auto px-4 pb-1">
              {favorites.map(r => (
                <button key={r.id} onClick={() => openEstablishment(r.id)} className="flex-shrink-0 flex items-center gap-3 bg-card border border-border rounded-xl px-3 py-3 min-w-[180px]">
                  <img src={r.images[0]} alt={r.name} className="w-10 h-10 rounded-lg object-cover flex-shrink-0 bg-muted" />
                  <div className="min-w-0 text-left">
                    <p className="font-medium text-foreground text-xs line-clamp-1">{r.name}</p>
                    <p className="text-muted-foreground text-[10px] mt-0.5">{formatDistance(r.distanceM)}</p>
                    <StatusBadge status={r.orderingStatus} highDemand={r.highDemand} size="2xs" />
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {pastOrders.length > 0 && (
          <div className="pt-5 px-4">
            <div className="flex items-center justify-between mb-3">
              <p className="font-display font-semibold text-foreground text-sm">Seus últimos pedidos</p>
              <button onClick={() => go('orders')} className="text-primary text-xs font-medium">Ver todos</button>
            </div>
            <div className="flex flex-col gap-2">
              {pastOrders.map(({ order }) => (
                <div key={order.id} className="bg-card border border-border rounded-xl p-4">
                  <p className="font-display font-semibold text-foreground text-sm">{order.establishmentName}</p>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{order.lines.map(line => `${line.quantity}× ${line.name}`).join(', ')}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-xs text-muted-foreground">{formatCurrency(order.total)}</span>
                    <span className="text-border">·</span>
                    <span className="text-xs text-muted-foreground">{new Date(order.createdAt).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })}</span>
                    <span className="text-border">·</span>
                    <span className="text-xs text-success font-medium">Entregue</span>
                  </div>
                  <div className="flex gap-2 mt-3">
                    <button onClick={() => openOrder(order.id, 'receipt')} className="flex-1 bg-muted text-muted-foreground text-xs font-medium py-2 rounded-lg">Ver comprovante</button>
                    <button onClick={() => openEstablishment(order.establishmentId)} className="flex-1 border border-border text-foreground text-xs font-medium py-2 rounded-lg">Ver restaurante</button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function HomeInBarScreen() {
  const { go, account, table, setTable, clearCart, openMenu, openItem } = useClient();
  const establishment = useEstablishment(table?.establishmentId);
  const now = useNow(30_000);
  const menu = usePricedMenu(table?.establishmentId ?? '', now);
  const { active } = useClientOrders();
  const [leaveSheet, setLeaveSheet] = useState(false);
  const firstName = account?.name.split(' ')[0];

  if (!table || !establishment) return null;
  const highlights = menu.filter(item => item.highlighted && item.available).slice(0, 4);

  function confirmLeave() {
    setTable(null);
    clearCart();
    setLeaveSheet(false);
    go('home-out-of-bar');
  }

  return (
    <div className="min-h-screen bg-background flex flex-col pb-20">
      {leaveSheet && (
        <BottomSheet onClose={() => setLeaveSheet(false)}>
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 rounded-xl bg-error/10 flex items-center justify-center flex-shrink-0">
              <LogOut size={18} className="text-error" />
            </div>
            <div>
              <p className="font-display font-bold text-foreground">Sair do restaurante?</p>
              <p className="text-xs text-muted-foreground">{establishment.name} · {table.tableLabel}</p>
            </div>
          </div>
          {active && (
            <div className="bg-warning/10 border border-warning/20 rounded-xl px-4 py-3 mb-4 flex items-start gap-2">
              <AlertCircle size={15} className="text-warning flex-shrink-0 mt-0.5" />
              <p className="text-sm text-warning">Você tem um pedido ativo. Ao sair, ele continua sendo preparado e pode ser acompanhado em Pedidos.</p>
            </div>
          )}
          <p className="text-sm text-muted-foreground mb-5">Itens no carrinho serão descartados.</p>
          <div className="flex flex-col gap-2">
            <button onClick={confirmLeave} className="w-full bg-error text-white font-display font-semibold py-4 rounded-xl">Sair do restaurante</button>
            <button onClick={() => setLeaveSheet(false)} className="w-full bg-muted text-foreground font-display font-semibold py-4 rounded-xl">Continuar aqui</button>
          </div>
        </BottomSheet>
      )}

      <div className="bg-card border-b border-border px-5 pt-5 pb-4">
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="flex items-center gap-2">
              <p className="font-display font-bold text-foreground">{establishment.name}</p>
              <div className="w-1.5 h-1.5 rounded-full bg-success animate-pulse" />
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">{table.tableLabel}</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={() => setLeaveSheet(true)} className="p-2 rounded-lg hover:bg-muted text-muted-foreground" aria-label="Sair do restaurante">
              <LogOut size={17} />
            </button>
            <Avatar />
          </div>
        </div>
        <button onClick={() => openMenu(establishment.id)} className="w-full relative text-left">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <span className="block w-full bg-muted rounded-xl pl-9 pr-4 py-3 text-sm text-muted-foreground">Buscar no cardápio...</span>
        </button>
      </div>

      <div className="px-5 pt-5">
        <h1 className="font-display font-bold text-foreground text-xl">
          {firstName ? `O que vai pedir hoje, ${firstName}?` : 'O que vai pedir hoje?'}
        </h1>
        {establishment.highDemand && (
          <div className="mt-3 bg-warning-bg border border-warning/20 rounded-xl p-4 flex flex-col gap-1">
            <p className="font-display font-semibold text-warning text-sm">⚠️ Alta demanda</p>
            <p className="text-warning/80 text-sm">Seu pedido pode levar mais tempo que o normal.</p>
          </div>
        )}
        <div className="flex items-center gap-2 mt-4">
          <div className="flex items-center gap-1.5 bg-card border border-border rounded-lg px-3 py-2">
            <Clock size={13} className="text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Tempo médio: <strong className="text-foreground">{establishment.avgTime}</strong></span>
          </div>
        </div>
      </div>

      {active && (
        <div className="px-5 pt-5">
          <ActiveOrderCard order={active.order} status={active.status} />
        </div>
      )}

      {highlights.length > 0 && (
        <div className="px-5 mt-5">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-3">Mais pedidos</p>
          <div className="flex gap-3 overflow-x-auto pb-1">
            {highlights.map(item => (
              <button key={item.id} onClick={() => openItem(item.id)} className="flex-shrink-0 w-28 bg-card border border-border rounded-xl overflow-hidden text-left">
                <img src={item.image} alt={item.name} className="w-full h-20 object-cover bg-muted" />
                <div className="p-2">
                  <p className="text-xs font-medium text-foreground leading-tight line-clamp-2">{item.name}</p>
                  <p className="text-xs text-primary font-bold mt-1">{formatCurrency(item.finalPrice)}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="px-5 mt-5">
        <button
          onClick={() => openMenu(establishment.id)}
          className="w-full bg-primary text-primary-foreground font-display font-semibold py-4 rounded-xl text-base flex items-center justify-center gap-2"
        >
          Ver cardápio completo
          <ChevronRight size={18} />
        </button>
      </div>
    </div>
  );
}
