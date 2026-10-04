import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  type OnGatewayConnection,
  type OnGatewayInit,
} from '@nestjs/websockets';
import { isUUID } from 'class-validator';
import type { Namespace, Socket } from 'socket.io';
import { REALTIME_NAMESPACE, STAFF_ROLES, type RealtimeSubscribeRequest } from '@filafacil/shared';
import { PrismaService } from '../../database/prisma.service.js';
import { ACCESS_COOKIE } from '../auth/auth-cookies.js';
import type { AuthContext } from '../auth/auth.types.js';
import { SessionService } from '../auth/session.service.js';
import { TokenService } from '../auth/token.service.js';
import { RealtimeService } from './realtime.service.js';
import { rooms } from './rooms.js';

interface SocketData {
  /** Resolvida no handshake; mensagens que chegam antes aguardam a autenticação terminar. */
  auth?: Promise<AuthContext | null>;
}

function readCookie(header: string | undefined, name: string) {
  for (const part of header?.split(';') ?? []) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return decodeURIComponent(value.join('='));
  }
  return undefined;
}

/**
 * Canal de tempo real. A autenticação usa o mesmo cookie HttpOnly da API; clientes anônimos
 * só podem assinar salas públicas (cardápio de um restaurante). Salas de equipe exigem vínculo.
 */
@WebSocketGateway({ namespace: REALTIME_NAMESPACE })
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly realtime: RealtimeService,
    private readonly tokens: TokenService,
    private readonly sessions: SessionService,
    private readonly prisma: PrismaService,
  ) {}

  afterInit(server: Namespace) {
    this.realtime.attach(server);
  }

  handleConnection(socket: Socket) {
    (socket.data as SocketData).auth = this.authenticate(socket);
  }

  private async authenticate(socket: Socket): Promise<AuthContext | null> {
    const token = readCookie(socket.handshake.headers.cookie, ACCESS_COOKIE);
    const payload = token ? await this.tokens.verifyAccessToken(token) : null;
    if (!payload) return null;
    try {
      const auth = await this.sessions.authenticate(payload);
      await socket.join(rooms.user(auth.userId));
      return auth;
    } catch {
      // Sessão inválida: segue como conexão anônima.
      return null;
    }
  }

  @SubscribeMessage('subscribe')
  async subscribe(@ConnectedSocket() socket: Socket, @MessageBody() body: RealtimeSubscribeRequest) {
    const restaurantId = body?.restaurantId;
    const establishmentId = body?.establishmentId;
    if (typeof restaurantId === 'string' && isUUID(restaurantId)) {
      await socket.join(rooms.restaurant(restaurantId));
      return { ok: true };
    }
    if (typeof establishmentId === 'string' && isUUID(establishmentId)) {
      const auth = await (socket.data as SocketData).auth;
      const allowed =
        auth &&
        STAFF_ROLES.includes(auth.role) &&
        (await this.prisma.establishmentMembership.count({ where: { userId: auth.userId, establishmentId } })) > 0;
      if (!allowed) return { ok: false };
      await socket.join(rooms.staff(establishmentId));
      return { ok: true };
    }
    return { ok: false };
  }

  @SubscribeMessage('unsubscribe')
  async unsubscribe(@ConnectedSocket() socket: Socket, @MessageBody() body: RealtimeSubscribeRequest) {
    if (typeof body?.restaurantId === 'string') await socket.leave(rooms.restaurant(body.restaurantId));
    if (typeof body?.establishmentId === 'string') await socket.leave(rooms.staff(body.establishmentId));
    return { ok: true };
  }

  handleError(error: unknown) {
    this.logger.warn(error instanceof Error ? error.message : String(error));
  }
}
