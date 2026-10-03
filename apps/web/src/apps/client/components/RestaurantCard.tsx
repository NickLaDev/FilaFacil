import { Clock, Heart, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Establishment, OrderingStatus } from '@/types/establishment';
import { formatDistance } from '../format';

export function StatusBadge({ status, highDemand, size = 'xs' }: { status: OrderingStatus; highDemand: boolean; size?: 'xs' | '2xs' }) {
  const text = size === 'xs' ? 'text-xs' : 'text-[10px]';
  if (status === 'closed') {
    return (
      <span className={cn('flex items-center gap-1 text-error font-medium', text)}>
        <span className="w-1.5 h-1.5 rounded-full bg-error inline-block" />Fechado
      </span>
    );
  }
  if (status === 'paused') {
    return (
      <span className={cn('flex items-center gap-1 font-medium text-indigo-500', text)}>
        <span className="w-1.5 h-1.5 rounded-full inline-block bg-indigo-500" />Pedidos pausados
      </span>
    );
  }
  if (highDemand) {
    return (
      <span className={cn('flex items-center gap-1 text-warning font-medium', text)}>
        <span className="w-1.5 h-1.5 rounded-full bg-warning inline-block" />Alta demanda
      </span>
    );
  }
  return (
    <span className={cn('flex items-center gap-1 text-success font-medium', text)}>
      <span className="w-1.5 h-1.5 rounded-full bg-success animate-pulse inline-block" />Aceitando pedidos
    </span>
  );
}

interface FavoriteButtonProps {
  isFavorite: boolean;
  onToggle: () => void;
  className?: string;
}

/** Remover/adicionar favorito com um toque (ficha 45). */
export function FavoriteButton({ isFavorite, onToggle, className }: FavoriteButtonProps) {
  return (
    <button
      onClick={event => {
        event.stopPropagation();
        onToggle();
      }}
      aria-pressed={isFavorite}
      aria-label={isFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
      className={cn('w-8 h-8 rounded-full bg-black/30 flex items-center justify-center backdrop-blur-sm', className)}
    >
      <Heart size={15} className={isFavorite ? 'fill-error text-error' : 'text-white'} />
    </button>
  );
}

interface RestaurantCardProps {
  restaurant: Establishment;
  onPress: () => void;
  isFavorite?: boolean;
  onToggleFavorite?: () => void;
}

export default function RestaurantCard({ restaurant: r, onPress, isFavorite = false, onToggleFavorite }: RestaurantCardProps) {
  const closed = r.orderingStatus === 'closed';
  return (
    <div
      className={cn('w-full bg-card border border-border rounded-xl overflow-hidden text-left transition-all hover:border-primary/30 cursor-pointer', closed && 'opacity-75')}
      onClick={onPress}
      role="button"
      tabIndex={0}
      onKeyDown={event => event.key === 'Enter' && onPress()}
    >
      <div className="relative h-36">
        <img src={r.images[0]} alt={r.name} className={cn('w-full h-full object-cover bg-muted', closed && 'grayscale')} />
        {onToggleFavorite && <FavoriteButton isFavorite={isFavorite} onToggle={onToggleFavorite} className="absolute top-3 right-3" />}
        {r.highDemand && !closed && (
          <span className="absolute bottom-3 left-3 text-[10px] font-bold bg-warning text-white px-2 py-1 rounded-full">Alta demanda</span>
        )}
      </div>
      <div className="p-4">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <p className="font-display font-semibold text-foreground">{r.name}</p>
            <div className="flex items-center gap-2 mt-1 flex-wrap">
              <span className="text-xs text-muted-foreground">{r.foodCategories.join(' · ') || r.type}</span>
              <span className="text-border">·</span>
              <span className="text-xs text-muted-foreground">{formatDistance(r.distanceM)}</span>
              {r.ratingCount > 0 && (
                <>
                  <span className="text-border">·</span>
                  <div className="flex items-center gap-0.5">
                    <Star size={11} className="fill-primary text-primary" />
                    <span className="text-xs text-foreground font-medium">{r.rating}</span>
                  </div>
                </>
              )}
            </div>
          </div>
          {!closed && (
            <div className="bg-muted rounded-lg px-2 py-1 flex-shrink-0">
              <div className="flex items-center gap-1">
                <Clock size={11} className="text-muted-foreground" />
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">{r.avgTime}</span>
              </div>
            </div>
          )}
        </div>
        <div className="mt-2">
          <StatusBadge status={r.orderingStatus} highDemand={r.highDemand} />
        </div>
      </div>
    </div>
  );
}
