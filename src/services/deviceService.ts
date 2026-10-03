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
 * Mock da leitura biométrica. Em produção: WebAuthn com challenge emitido pelo servidor
 * (ou bridge nativa no app), nunca validação só no cliente.
 */
export function requestBiometricAuth(): Promise<boolean> {
  return new Promise(resolve => setTimeout(() => resolve(true), 900));
}

// ─── Localização (ficha 11) ─────────────────────────────────────────────────

interface ClientLocation {
  label: string;
  source: 'default' | 'device' | 'manual';
}

const locationStore = createPersistentStore<ClientLocation>('client-location', { label: 'Campinas, SP', source: 'default' });

export const useClientLocation = () => useStore(locationStore);

/**
 * Pede a localização do aparelho. As coordenadas seriam enviadas à busca do backend
 * (ordenação por distância); o mock só registra que a permissão foi concedida.
 */
export function requestDeviceLocation(): Promise<'granted' | 'denied' | 'unsupported'> {
  if (!('geolocation' in navigator)) return Promise.resolve('unsupported');
  return new Promise(resolve => {
    navigator.geolocation.getCurrentPosition(
      () => {
        locationStore.set({ label: 'Sua localização atual', source: 'device' });
        resolve('granted');
      },
      () => resolve('denied'),
      { timeout: 8000, maximumAge: 5 * 60 * 1000 },
    );
  });
}

export function setManualLocation(label: string) {
  locationStore.set({ label, source: 'manual' });
}
