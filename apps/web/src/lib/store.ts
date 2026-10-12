import { useSyncExternalStore } from 'react';

type Listener = () => void;
type Updater<T> = T | ((prev: T) => T);

export interface Store<T> {
  get: () => T;
  set: (updater: Updater<T>) => void;
  subscribe: (listener: Listener) => () => void;
}

const STORAGE_PREFIX = 'filafacil:v1:';

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    // Dados adulterados/antigos com outro formato voltam ao seed em vez de quebrar a UI.
    const sameShape = Array.isArray(parsed) === Array.isArray(fallback) && typeof parsed === typeof fallback;
    return sameShape && parsed !== null ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Sem espaço ou storage bloqueado: o estado segue válido em memória.
  }
}

/**
 * Store em memória espelhado no localStorage. Usado só para o que ainda não tem API
 * e para preferências do aparelho (ex.: região escolhida).
 * Dados da Sprint 1 vêm sempre do backend.
 */
export function createPersistentStore<T>(name: string, initial: T): Store<T> {
  const key = STORAGE_PREFIX + name;
  const listeners = new Set<Listener>();
  let state = readStorage(key, initial);

  const notify = () => listeners.forEach(listener => listener());

  window.addEventListener('storage', event => {
    if (event.key !== key) return;
    state = event.newValue === null ? initial : readStorage(key, initial);
    notify();
  });

  return {
    get: () => state,
    set: updater => {
      state = typeof updater === 'function' ? (updater as (prev: T) => T)(state) : updater;
      writeStorage(key, state);
      notify();
    },
    subscribe: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export function useStore<T>(store: Store<T>): T {
  return useSyncExternalStore(store.subscribe, store.get);
}

/** Apaga os dados locais (preferências do aparelho). */
export function resetPersistentStores() {
  Object.keys(localStorage)
    .filter(key => key.startsWith(STORAGE_PREFIX))
    .forEach(key => localStorage.removeItem(key));
}
