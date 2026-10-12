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
    this.tablesUpdated(establishmentId);
  }

  /** Mapa de mesas mudou (chamado, ocupação, reserva, mescla, pagamento): a equipe recarrega o mapa. */
  tablesUpdated(establishmentId: string) {
    this.emit(rooms.staff(establishmentId), REALTIME_EVENTS.tablesUpdated, { establishmentId });
  }

  waitlistUpdated(establishmentId: string) {
    this.emit(rooms.staff(establishmentId), REALTIME_EVENTS.waitlistUpdated, { establishmentId });
  }

  /** Pedido criado, pago ou com novo status: o cliente dono e a equipe da casa recarregam o pedido. */
  orderUpdated(userId: string, establishmentId: string, orderId: string) {
    const payload = { establishmentId, orderId };
    this.emit(rooms.user(userId), REALTIME_EVENTS.orderUpdated, payload);
    this.emit(rooms.staff(establishmentId), REALTIME_EVENTS.orderUpdated, payload);
    this.tablesUpdated(establishmentId);
  }

  /** Papel, permissões ou vínculos do usuário mudaram: as conexões dele saem das salas da equipe na hora. */
  staffAccessChanged(userId: string) {
    const sockets = this.server?.in(rooms.user(userId)).fetchSockets();
    void sockets?.then(list => {
      for (const socket of list) for (const room of socket.rooms) if (room.startsWith('staff:')) socket.leave(room);
    });
  }

  sessionRevoked(userId: string, reason: string) {
    const room = rooms.user(userId);
    this.emit(room, REALTIME_EVENTS.sessionRevoked, { reason });
    setTimeout(() => this.server?.in(room).disconnectSockets(true), DISCONNECT_DELAY_MS).unref();
  }
}
