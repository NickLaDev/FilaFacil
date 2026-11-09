import { useState, type UIEvent } from 'react';
import { CalendarCheck, CalendarClock, ChevronLeft, Clock, Link2, MapPin, MessageCircle, Navigation, Pause, QrCode, Send, Share2, Star, Utensils, Wallet } from 'lucide-react';
import { SHARE_SOURCE_LABELS, type ShareSource } from '@filafacil/shared';
import BottomSheet from '@/components/ui/BottomSheet';
import { restaurantShareUrl, useRestaurantCashback, useRestaurantReviews } from '@/services/sprint4Service';
import { imageOrPlaceholder } from '@/lib/images';
import { cn } from '@/lib/utils';
import { LoadingBlock } from '@/components/ui/QueryState';
import { useClientLocation } from '@/services/deviceService';
import { useMyReservation } from '@/services/reservationService';
import { useRestaurant } from '@/services/restaurantService';
import { useClient } from '../clientContext';
import { useFavorites } from '../hooks/useFavorites';
import { FixedBottom } from '../components/Layout';
import { FavoriteButton, StatusBadge } from '../components/RestaurantCard';
import ReservationSheet from '../components/ReservationSheet';
import RestaurantUnavailable from '../components/RestaurantUnavailable';
import { distanceMeters, formatDistance } from '../format';

/** Página do restaurante: galeria, nota, endereço com rota e horário do dia (ficha 12). */
export default function RestaurantDetailScreen() {
  const { go, establishmentId, table, openMenu, account, showToast, setPostAuthScreen } = useClient();
  const query = useRestaurant(establishmentId);
  const restaurant = query.data;
  const { coords } = useClientLocation();
  const { favoriteIds, toggle } = useFavorites();
  const [photoIndex, setPhotoIndex] = useState(0);
  const [reserving, setReserving] = useState(false);
  const [sharing, setSharing] = useState(false);
  const cashbackRules = useRestaurantCashback(establishmentId).data ?? [];
  const reviews = useRestaurantReviews(establishmentId).data;
  const reservation = useMyReservation(establishmentId, Boolean(account));

  if (query.error) return <RestaurantUnavailable error={query.error} onRetry={() => void query.refetch()} onExplore={() => go('explore')} />;
  if (!restaurant) return <LoadingBlock className="min-h-screen" />;
  const closed = restaurant.orderingStatus === 'closed';
  const isLinked = table?.establishmentId === restaurant.id;
  const distance = restaurant.distanceM ?? distanceMeters(coords, { lat: restaurant.latitude, lng: restaurant.longitude });
  // "Como chegar" abre o app de mapas com as coordenadas cadastradas.
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${restaurant.latitude},${restaurant.longitude}`;

  function openReservation() {
    if (!account) {
      showToast('Entre na sua conta para reservar');
      setPostAuthScreen('restaurant-detail');
      go('login');
      return;
    }
    if (!reservation.data) {
      showToast(reservation.isError ? 'Não foi possível carregar sua reserva. Tente de novo.' : 'Carregando sua reserva…');
      if (reservation.isError) void reservation.refetch();
      return;
    }
    setReserving(true);
  }

  function openBooking() {
    if (!account) {
      showToast('Entre na sua conta para reservar');
      setPostAuthScreen('restaurant-detail');
      go('login');
      return;
    }
    go('booking');
  }

  /** Ficha 62: link público que abre direto nesta página (o app é web: funciona sem instalar nada). */
  async function share(source: ShareSource) {
    if (!restaurant) return;
    const url = restaurantShareUrl(restaurant.id, source);
    const text = `Vamos no ${restaurant.name}? Olha a página deles: ${url}`;
    try {
      if (source === 'copy') {
        await navigator.clipboard.writeText(url);
        showToast('Link copiado');
      } else if (source === 'native') {
        if (navigator.share) await navigator.share({ title: restaurant.name, text: `Vamos no ${restaurant.name}?`, url });
        else {
          await navigator.clipboard.writeText(url);
          showToast('Link copiado');
        }
      } else {
        const target = {
          whatsapp: `https://wa.me/?text=${encodeURIComponent(text)}`,
          telegram: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(`Vamos no ${restaurant.name}?`)}`,
          sms: `sms:?&body=${encodeURIComponent(text)}`,
          email: `mailto:?subject=${encodeURIComponent(restaurant.name)}&body=${encodeURIComponent(text)}`,
        }[source as 'whatsapp' | 'telegram' | 'sms' | 'email'];
        if (target) window.open(target, '_blank', 'noopener,noreferrer');
      }
    } catch {
      // Compartilhamento cancelado pelo usuário.
    }
    setSharing(false);
  }

  function handleGalleryScroll(event: UIEvent<HTMLDivElement>) {
    const { scrollLeft, clientWidth } = event.currentTarget;
    setPhotoIndex(Math.round(scrollLeft / clientWidth));
  }

  return (
    <div className="min-h-screen bg-background flex flex-col pb-72">
      <div className="relative h-48 flex-shrink-0">
        <div className="flex h-full overflow-x-auto snap-x snap-mandatory [scrollbar-width:none]" onScroll={handleGalleryScroll}>
          {(restaurant.images.length ? restaurant.images : [imageOrPlaceholder(null)]).map((image, index) => (
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
        <FavoriteButton isFavorite={favoriteIds.has(restaurant.id)} onToggle={() => toggle(restaurant.id, restaurant)} className="absolute top-4 right-4 w-9 h-9 bg-black/40" />
        <button onClick={() => setSharing(true)} data-testid="share-button" className="absolute top-4 right-16 w-9 h-9 rounded-full bg-black/40 backdrop-blur-sm flex items-center justify-center" aria-label="Compartilhar restaurante">
          <Share2 size={16} className="text-white" />
        </button>
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
              <span>{formatDistance(distance)}</span>
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
          {[...new Set([...restaurant.foodCategories, ...restaurant.tags])].map(tag => (
            <span key={tag} className="bg-muted text-muted-foreground text-xs px-3 py-1.5 rounded-full">{tag}</span>
          ))}
        </div>

        {cashbackRules.length > 0 && (
          <div data-testid="cashback-chip" className="flex items-center gap-2 bg-success-bg text-success rounded-xl px-4 py-3 text-sm">
            <Wallet size={15} className="flex-shrink-0" />
            <p>{cashbackRules.map(rule => rule.promotionName ? `${rule.percent}% de volta em ${rule.promotionName}` : `${rule.percent}% de cashback nos pedidos`).join(' · ')}</p>
          </div>
        )}

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
            <p className="text-sm text-muted-foreground">{restaurant.hoursLabel}</p>
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
            <p className="text-xs text-muted-foreground mt-1">{restaurant.hoursLabel}</p>
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
          <div data-testid="reviews" className="bg-card border border-border rounded-xl p-4 flex flex-col gap-3">
            <div className="flex items-center gap-4">
              <p data-testid="rating-average" className="font-display font-black text-foreground text-3xl">{restaurant.rating}</p>
              <div>
                <div className="flex gap-0.5">
                  {[1, 2, 3, 4, 5].map(star => (
                    <Star key={star} size={12} className={star <= Math.round(restaurant.rating) ? 'fill-primary text-primary' : 'text-border fill-border'} />
                  ))}
                </div>
                <p className="text-xs text-muted-foreground mt-1">Nota média · {restaurant.ratingCount} {restaurant.ratingCount === 1 ? 'avaliação' : 'avaliações'}</p>
              </div>
            </div>
            {reviews && reviews.items.length > 0 && (
              <ul className="flex flex-col divide-y divide-border border-t border-border">
                {reviews.items.map(review => (
                  <li key={review.id} data-testid="review-item" className="pt-3 pb-1 flex flex-col gap-1">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-sm font-medium text-foreground">{review.authorName}</p>
                      <div className="flex gap-0.5" aria-label={`${review.rating} de 5 estrelas`}>
                        {[1, 2, 3, 4, 5].map(star => <Star key={star} size={11} className={star <= review.rating ? 'fill-primary text-primary' : 'text-border fill-border'} />)}
                      </div>
                    </div>
                    {review.comment && <p className="text-sm text-muted-foreground">{review.comment}</p>}
                    <p className="text-[11px] text-muted-foreground">{new Date(review.createdAt).toLocaleDateString('pt-BR')}</p>
                  </li>
                ))}
              </ul>
            )}
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
        <button
          onClick={openReservation}
          disabled={!restaurant.reservationsOpen && !reservation.data?.reservation}
          className="w-full bg-card border border-border text-foreground font-medium py-3.5 rounded-xl text-sm flex items-center justify-center gap-2 disabled:opacity-50"
        >
          <CalendarCheck size={15} />
          {reservation.data?.reservation ? `Sua reserva · posição ${reservation.data.reservation.position}` : 'Reservar mesa'}
        </button>
        <button onClick={openBooking} data-testid="booking-button" className="w-full bg-card border border-border text-foreground font-medium py-3.5 rounded-xl text-sm flex items-center justify-center gap-2">
          <CalendarClock size={15} />
          Reservar com data e horário
        </button>
        {!restaurant.reservationsOpen && !reservation.data?.reservation && (
          <p className="text-xs text-muted-foreground text-center -mt-1">
            {closed ? 'Reservas disponíveis quando o restaurante estiver aberto.' : 'Este restaurante não aceita reservas pelo aplicativo.'}
          </p>
        )}
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

      {sharing && (
        <BottomSheet onClose={() => setSharing(false)}>
          <p className="font-display font-bold text-foreground text-lg mb-1">Compartilhar {restaurant.name}</p>
          <p className="text-xs text-muted-foreground mb-4">Seus amigos abrem a página do restaurante direto no navegador, sem precisar instalar nada.</p>
          <div className="grid grid-cols-2 gap-2">
            {([['whatsapp', MessageCircle], ['telegram', Send], ['sms', MessageCircle], ['email', Send], ['copy', Link2], ['native', Share2]] as [ShareSource, typeof Link2][]).map(([source, Icon]) => (
              <button key={source} data-testid={`share-${source}`} onClick={() => void share(source)} className="flex items-center gap-2 border border-border rounded-xl px-3 py-3 text-sm text-foreground hover:bg-muted/50">
                <Icon size={15} className="text-muted-foreground" />
                {SHARE_SOURCE_LABELS[source]}
              </button>
            ))}
          </div>
        </BottomSheet>
      )}

      {reserving && reservation.data && (
        <ReservationSheet restaurantId={restaurant.id} restaurantName={restaurant.name} state={reservation.data} notify={showToast} onClose={() => setReserving(false)} />
      )}
    </div>
  );
}
