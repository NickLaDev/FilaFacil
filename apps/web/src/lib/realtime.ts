import { useEffect, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import {
  REALTIME_EVENTS,
  REALTIME_NAMESPACE,
  type RealtimeEvent,
  type RealtimePayload,
  type RealtimeSubscribeRequest,
} from '@filafacil/shared';
import { API_BASE_URL, emitSessionEvent } from './api/client';

let socket: Socket | null = null;
/** Salas assinadas (com contagem de uso) para reassinar após reconexão. */
const subscriptions = new Map<string, { request: RealtimeSubscribeRequest; users: number }>();
const reconnectListeners = new Set<() => void>();
/** Conectado não basta: sem sessão válida no handshake o servidor não entrega os eventos da conta. */
let authenticated = false;
let recovery: (() => void) | null = null;
let lastRecoveryAt = 0;
const RECOVERY_COOLDOWN_MS = 30_000;

function getSocket() {
  if (socket) return socket;
  const base = new URL(API_BASE_URL, window.location.origin);
  socket = io(`${base.origin}${REALTIME_NAMESPACE}`, {
    path: `${base.pathname}/socket.io`,
    withCredentials: true,
    transports: ['websocket', 'polling'],
  });
  socket.on('connect', () => {
    authenticated = false; // até o servidor dizer (realtime.ready)
    subscriptions.forEach(({ request }) => socket?.emit('subscribe', request));
    // Eventos perdidos durante a queda: quem assina recarrega os dados pela API.
    reconnectListeners.forEach(listener => listener());
  });
  socket.on('disconnect', () => {
    authenticated = false;
    // Quem consulta a API por intervalo passa a usar o intervalo curto na hora, sem esperar o próximo ciclo.
    reconnectListeners.forEach(listener => listener());
  });
  socket.on(REALTIME_EVENTS.ready, (payload: RealtimePayload) => {
    authenticated = Boolean(payload?.authenticated);
    if (authenticated) {
      // A sala da conta só vale a partir daqui: recarrega o que possa ter passado antes.
      reconnectListeners.forEach(listener => listener());
    } else if (recovery && Date.now() - lastRecoveryAt > RECOVERY_COOLDOWN_MS) {
      lastRecoveryAt = Date.now();
      recovery();
    }
  });
  socket.on(REALTIME_EVENTS.sessionRevoked, (payload: RealtimePayload) => {
    emitSessionEvent(payload.reason === 'suspended' ? 'suspended' : 'expired');
  });
  return socket;
}

/**
 * O tempo real está funcionando para a conta? Exige conexão E sessão autenticada nela. Caso contrário, as telas
 * consultam a API em intervalo curto (uma conexão anônima "conectada" nunca receberia os eventos).
 */
export const isRealtimeHealthy = () => Boolean(socket?.connected) && authenticated;

/**
 * Registra o que fazer quando a conexão sobe sem sessão enquanto há alguém logado (cookie de acesso vencido):
 * renovar a sessão e reconectar. Com intervalo mínimo entre tentativas, para nunca virar laço.
 */
export function setRealtimeRecovery(handler: () => void) {
  recovery = handler;
}

/** Reconecta com os cookies atuais (depois de login/logout as salas de usuário mudam). */
export function reconnectRealtime() {
  if (!socket) return;
  socket.disconnect();
  socket.connect();
}

/**
 * Assina uma sala (cardápio público de um restaurante ou painel da equipe) e chama `onChange`
 * quando um dos eventos chega — ou quando a conexão volta, para não perder atualizações.
 */
export function useRealtime(request: RealtimeSubscribeRequest | null, events: RealtimeEvent[], onChange: () => void) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const key = request ? JSON.stringify(request) : null;
  const eventsKey = events.join(',');

  useEffect(() => {
    if (!key) return;
    const parsed = JSON.parse(key) as RealtimeSubscribeRequest;
    const target = parsed.restaurantId ?? parsed.establishmentId;
    const client = getSocket();
    const current = subscriptions.get(key);
    subscriptions.set(key, { request: parsed, users: (current?.users ?? 0) + 1 });
    if (!current && client.connected) client.emit('subscribe', parsed);

    const handler = (payload: RealtimePayload) => {
      if (!payload?.establishmentId || payload.establishmentId === target) onChangeRef.current();
    };
    const names = eventsKey.split(',') as RealtimeEvent[];
    names.forEach(name => client.on(name, handler));
    const onReconnect = () => onChangeRef.current();
    reconnectListeners.add(onReconnect);

    return () => {
      names.forEach(name => client.off(name, handler));
      reconnectListeners.delete(onReconnect);
      const entry = subscriptions.get(key);
      if (!entry) return;
      if (entry.users > 1) subscriptions.set(key, { ...entry, users: entry.users - 1 });
      else {
        subscriptions.delete(key);
        client.emit('unsubscribe', parsed);
      }
    };
  }, [key, eventsKey]);
}

/**
 * Eventos da conta logada (ex.: andamento dos pedidos). A sala `user:<id>` é atribuída pelo servidor
 * ao conectar, então não há assinatura: basta escutar. `onChange` também roda quando a conexão volta,
 * para recuperar o que passou durante a queda.
 */
export function useUserRealtime(events: RealtimeEvent[], onChange: () => void, enabled = true) {
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  const eventsKey = events.join(',');

  useEffect(() => {
    if (!enabled) return;
    const client = getSocket();
    const handler = () => onChangeRef.current();
    const names = eventsKey.split(',') as RealtimeEvent[];
    names.forEach(name => client.on(name, handler));
    reconnectListeners.add(handler);
    return () => {
      names.forEach(name => client.off(name, handler));
      reconnectListeners.delete(handler);
    };
  }, [eventsKey, enabled]);
}
