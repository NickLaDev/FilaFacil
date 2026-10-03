import { useState, type UIEvent } from 'react';
import { ChevronLeft, Clock, MapPin, Navigation, Pause, QrCode, Star, Utensils } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useEstablishment } from '@/services/establishmentService';
import { useClient } from '../clientContext';
import { useFavorites } from '../hooks/useFavorites';
import { FixedBottom } from '../components/Layout';
import { FavoriteButton, StatusBadge } from '../components/RestaurantCard';
import { formatDistance } from '../format';

/** Página do restaurante: galeria, nota, endereço com rota e horário do dia (ficha 12). */
export default function RestaurantDetailScreen() {
  const { go, establishmentId, table, openMenu } = useClient();
  const restaurant = useEstablishment(establishmentId);
  const { favoriteIds, toggle } = useFavorites();
  const [photoIndex, setPhotoIndex] = useState(0);

  if (!restaurant) return null;
  const closed = restaurant.orderingStatus === 'closed';
  const isLinked = table?.establishmentId === restaurant.id;
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(`${restaurant.address}, ${restaurant.city}`)}`;

  function handleGalleryScroll(event: UIEvent<HTMLDivElement>) {
    const { scrollLeft, clientWidth } = event.currentTarget;
    setPhotoIndex(Math.round(scrollLeft / clientWidth));
  }

  return (
    <div className="min-h-screen bg-background flex flex-col pb-52">
      <div className="relative h-48 flex-shrink-0">
        <div className="flex h-full overflow-x-auto snap-x snap-mandatory [scrollbar-width:none]" onScroll={handleGalleryScroll}>
          {restaurant.images.map((image, index) => (
            <img
              key={image}
              src={image}
              alt={`${restaurant.name} — foto ${index + 1}`}
              className={cn('w-full h-full object-cover flex-shrink-0 snap-center', closed && 'grayscale')}
            />
          ))}
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/10 pointer-events-none" />
        <button
          onClick={() => go(isLinked ? 'home-in-bar' : 'explore')}
          className="absolute top-4 left-4 w-9 h-9 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center"
          aria-label="Voltar"
        >
          <ChevronLeft size={18} className="text-white" />
        </button>
        <FavoriteButton isFavorite={favoriteIds.has(restaurant.id)} onToggle={() => toggle(restaurant.id)} className="absolute top-4 right-4 w-9 h-9 bg-black/40" />
        {restaurant.images.length > 1 && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex gap-1.5">
            {restaurant.images.map((image, index) => (
              <span key={image} className={cn('h-1.5 rounded-full transition-all', index === photoIndex ? 'w-4 bg-white' : 'w-1.5 bg-white/50')} />
            ))}
          </div>
        )}
      </div>

      <div className="px-5 py-5 flex flex-col gap-5">
        <div>
          <div className="flex items-start justify-between gap-3">
            <h1 className="font-display font-bold text-foreground text-xl flex-1">{restaurant.name}</h1>
            {restaurant.ratingCount > 0 && (
              <div className="flex items-center gap-1 flex-shrink-0 mt-0.5">
                <Star size={14} className="fill-primary text-primary" />
                <span className="font-display font-bold text-foreground">{restaurant.rating}</span>
                <span className="text-muted-foreground text-xs">({restaurant.ratingCount})</span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3 mt-2 flex-wrap">
            <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
              <MapPin size={13} />
              <span>{formatDistance(restaurant.distanceM)}</span>
            </div>
            {!closed && (
              <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
                <Clock size={13} />
                <span>Espera: {restaurant.avgTime}</span>
              </div>
            )}
          </div>
          <div className="mt-2">
            <StatusBadge status={restaurant.orderingStatus} highDemand={restaurant.highDemand} />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          {[...restaurant.foodCategories, ...restaurant.tags].map(tag => (
            <span key={tag} className="bg-muted text-muted-foreground text-xs px-3 py-1.5 rounded-full">{tag}</span>
          ))}
        </div>

        <div className="bg-card border border-border rounded-xl p-4 flex flex-col gap-3">
          <div className="flex items-start gap-3">
            <MapPin size={15} className="text-muted-foreground mt-0.5 flex-shrink-0" />
            <div>
              <p className="text-sm text-foreground">{restaurant.address}</p>
              <a href={directionsUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary text-xs font-medium mt-1">
                <Navigation size={11} />
                Como chegar
              </a>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Clock size={15} className="text-muted-foreground flex-shrink-0" />
            <p className="text-sm text-muted-foreground">{restaurant.hours}</p>
          </div>
        </div>

        {!isLinked && !closed && (
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
            <p className="text-sm font-medium text-foreground">Você pode consultar o cardápio.</p>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Para fazer um pedido, confirme sua presença pelo QR Code da mesa.
            </p>
          </div>
        )}

        {closed && (
          <div className="bg-muted rounded-xl p-4">
            <p className="text-sm font-medium text-foreground">Estabelecimento fechado</p>
            <p className="text-xs text-muted-foreground mt-1">{restaurant.hours}</p>
          </div>
        )}

        {restaurant.orderingStatus === 'paused' && (
          <div className="rounded-xl p-4 border bg-indigo-50 border-indigo-200">
            <div className="flex items-center gap-2 mb-1">
              <Pause size={14} className="text-indigo-500" />
              <p className="text-sm font-semibold text-indigo-500">Pedidos temporariamente pausados</p>
            </div>
            <p className="text-xs text-indigo-500/80">Este restaurante pausou novos pedidos. Você ainda pode ver o cardápio.</p>
          </div>
        )}

        {restaurant.ratingCount > 0 && (
          <div className="bg-card border border-border rounded-xl p-4 flex items-center gap-4">
            <p className="font-display font-black text-foreground text-3xl">{restaurant.rating}</p>
            <div>
              <div className="flex gap-0.5">
                {[1, 2, 3, 4, 5].map(star => (
                  <Star key={star} size={12} className={star <= Math.round(restaurant.rating) ? 'fill-primary text-primary' : 'text-border fill-border'} />
                ))}
              </div>
              <p className="text-xs text-muted-foreground mt-1">Nota média · {restaurant.ratingCount} avaliações</p>
            </div>
          </div>
        )}
      </div>

      <FixedBottom aboveNav className="flex flex-col gap-2 bg-gradient-to-t from-background via-background to-transparent pt-6">
        <button
          onClick={() => openMenu(restaurant.id)}
          className="w-full bg-primary text-primary-foreground font-display font-semibold py-3.5 rounded-xl flex items-center justify-center gap-2"
        >
          <Utensils size={16} />
          Ver cardápio
        </button>
        {!isLinked && !closed && (
          <button
            onClick={() => go('qr-scanner')}
            className="w-full bg-card border border-border text-foreground font-medium py-3.5 rounded-xl text-sm flex items-center justify-center gap-2"
          >
            <QrCode size={15} />
            Escanear QR para pedir
          </button>
        )}
      </FixedBottom>
    </div>
  );
}
