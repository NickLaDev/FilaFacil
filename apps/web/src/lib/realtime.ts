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

function getSocket() {
  if (socket) return socket;
  const base = new URL(API_BASE_URL, window.location.origin);
  socket = io(`${base.origin}${REALTIME_NAMESPACE}`, {
    path: `${base.pathname}/socket.io`,
    withCredentials: true,
    transports: ['websocket', 'polling'],
  });
  socket.on('connect', () => {
    subscriptions.forEach(({ request }) => socket?.emit('subscribe', request));
    // Eventos perdidos durante a queda: quem assina recarrega os dados pela API.
    reconnectListeners.forEach(listener => listener());
  });
  socket.on(REALTIME_EVENTS.sessionRevoked, (payload: RealtimePayload) => {
    emitSessionEvent(payload.reason === 'suspended' ? 'suspended' : 'expired');
  });
  return socket;
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
