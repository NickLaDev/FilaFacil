export const formatDistance = (meters: number | null) =>
  meters === null ? '' : meters < 1000 ? `${meters} m` : `${(meters / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} km`;

export const PAYMENT_METHOD_LABELS = {
  pix: 'Pix',
  credit: 'Cartão de crédito',
  debit: 'Cartão de débito',
} as const;

const EARTH_RADIUS_M = 6_371_000;
const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

/** Distância em linha reta (Haversine), para quando a tela não veio da busca por proximidade. */
export function distanceMeters(from: { lat: number; lng: number }, to: { lat: number; lng: number }) {
  const dLat = toRadians(to.lat - from.lat);
  const dLng = toRadians(to.lng - from.lng);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRadians(from.lat)) * Math.cos(toRadians(to.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(a)));
}
