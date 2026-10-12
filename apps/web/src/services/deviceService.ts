import { createPersistentStore, useStore } from '@/lib/store';

// ─── Biometria (ficha 59) ───────────────────────────────────────────────────

/** Verdadeiro quando o aparelho tem Face ID / Touch ID / leitor de digital disponível. */
export async function isBiometricAvailable() {
  try {
    return (await window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.()) ?? false;
  } catch {
    return false;
  }
}

/**
 * Dica de interface: id da credencial biométrica cadastrada NESTE aparelho (atalho no login e estado do
 * botão no perfil). Quem decide se a biometria vale é o servidor (credencial + desafio); apagar isto não abre acesso.
 */
const biometricHintStore = createPersistentStore<{ credentialId: string | null }>('biometric-hint-v2', { credentialId: null });

export const useBiometricCredentialId = () => useStore(biometricHintStore).credentialId;
export const useBiometricHint = () => Boolean(useStore(biometricHintStore).credentialId);
export const setBiometricHint = (credentialId: string | null) => biometricHintStore.set({ credentialId });

// ─── Localização (ficha 11) ─────────────────────────────────────────────────

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface ClientLocation {
  label: string;
  source: 'default' | 'device' | 'manual';
  coords: Coordinates;
}

/**
 * Regiões que o cliente pode escolher sem GPS. Texto livre exigiria geocodificação por um
 * serviço externo (não contratado nesta fase), então a escolha manual usa esta lista.
 */
export const KNOWN_REGIONS: { label: string; coords: Coordinates }[] = [
  { label: 'Centro, Campinas', coords: { lat: -22.9056, lng: -47.0608 } },
  { label: 'Cambuí, Campinas', coords: { lat: -22.8936, lng: -47.0517 } },
  { label: 'Barão Geraldo, Campinas', coords: { lat: -22.8213, lng: -47.0794 } },
  { label: 'Cidade Universitária, Campinas', coords: { lat: -22.8174, lng: -47.0689 } },
  { label: 'Taquaral, Campinas', coords: { lat: -22.8745, lng: -47.0559 } },
  { label: 'Bela Vista, São Paulo', coords: { lat: -23.5614, lng: -46.6559 } },
];

const DEFAULT_LOCATION: ClientLocation = { label: 'Campinas, SP', source: 'default', coords: KNOWN_REGIONS[0].coords };

const locationStore = createPersistentStore<ClientLocation>('client-location-v2', DEFAULT_LOCATION);

export const useClientLocation = () => useStore(locationStore);

/** Pede a localização do aparelho; as coordenadas vão para a busca por distância no servidor. */
export function requestDeviceLocation(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!('geolocation' in navigator)) return Promise.resolve('unsupported');
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      position => {
        const { latitude, longitude } = position.coords;
        locationStore.set({ label: 'Sua localização atual', source: 'device', coords: { lat: latitude, lng: longitude } });
        resolve('granted');
      },
      () => resolve('denied'),
      { timeout: 8000, maximumAge: 5 * 60 * 1000 },
    );
  });
}

export function setManualLocation(region: (typeof KNOWN_REGIONS)[number]) {
  locationStore.set({ label: region.label, source: 'manual', coords: region.coords });
}

export function findRegions(query: string) {
  const normalized = query.trim().toLocaleLowerCase('pt-BR');
  return normalized ? KNOWN_REGIONS.filter(region => region.label.toLocaleLowerCase('pt-BR').includes(normalized)) : KNOWN_REGIONS;
}
