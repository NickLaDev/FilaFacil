import { Injectable } from '@nestjs/common';
import type { Namespace } from 'socket.io';
import { REALTIME_EVENTS, type RealtimeEvent, type RealtimePayload } from '@filafacil/shared';
import { rooms } from './rooms.js';

/** Dá tempo do aviso de revogação chegar ao navegador antes de derrubar a conexão. */
const DISCONNECT_DELAY_MS = 1000;

/**
 * Emissor de eventos para os navegadores. Os payloads só dizem "o que mudou";
 * o app busca o estado novo pela API, que continua sendo a fonte da verdade.
 */
@Injectable()
export class RealtimeService {
  private server: Namespace | null = null;

  attach(server: Namespace) {
    this.server = server;
  }

  private emit(room: string, event: RealtimeEvent, payload: RealtimePayload) {
    this.server?.to(room).emit(event, payload);
  }

  /** Cardápio público mudou: clientes com o cardápio aberto e a equipe recarregam. */
  menuUpdated(establishmentId: string) {
    this.emit(rooms.restaurant(establishmentId), REALTIME_EVENTS.menuUpdated, { establishmentId });
    this.emit(rooms.staff(establishmentId), REALTIME_EVENTS.menuUpdated, { establishmentId });
  }

  availabilityChanged(establishmentId: string) {
    this.menuUpdated(establishmentId);
    this.emit(rooms.staff(establishmentId), REALTIME_EVENTS.availabilityChanged, { establishmentId });
  }

  restaurantUpdated(establishmentId: string) {
    this.emit(rooms.restaurant(establishmentId), REALTIME_EVENTS.restaurantUpdated, { establishmentId });
  }

  /** Plano ou status mudou: a equipe recarrega recursos liberados e o cliente, o cardápio. */
  establishmentUpdated(establishmentId: string) {
    this.emit(rooms.staff(establishmentId), REALTIME_EVENTS.establishmentUpdated, { establishmentId });
    this.restaurantUpdated(establishmentId);
    this.menuUpdated(establishmentId);
  }

  floorPlanUpdated(establishmentId: string) {
    this.emit(rooms.staff(establishmentId), REALTIME_EVENTS.floorPlanUpdated, { establishmentId });
  }

  waitlistUpdated(establishmentId: string) {
    this.emit(rooms.staff(establishmentId), REALTIME_EVENTS.waitlistUpdated, { establishmentId });
  }

  sessionRevoked(userId: string, reason: string) {
    const room = rooms.user(userId);
    this.emit(room, REALTIME_EVENTS.sessionRevoked, { reason });
    setTimeout(() => this.server?.in(room).disconnectSockets(true), DISCONNECT_DELAY_MS).unref();
  }
}
