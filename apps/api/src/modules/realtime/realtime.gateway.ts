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
import { REALTIME_EVENTS, REALTIME_NAMESPACE, STAFF_ROLES, type RealtimeSubscribeRequest } from '@filafacil/shared';
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
    const auth = this.authenticate(socket);
    (socket.data as SocketData).auth = auth;
    // Avisa se a conexão tem sessão: uma conexão anônima fica "conectada", mas nunca recebe eventos da conta.
    void auth.then(context => socket.emit(REALTIME_EVENTS.ready, { authenticated: context !== null }));
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
      if (!auth || !(await this.canJoinStaffRoom(auth, establishmentId))) return { ok: false };
      await socket.join(rooms.staff(establishmentId));
      return { ok: true };
    }
    return { ok: false };
  }

  /**
   * Confere no banco, a cada assinatura (o contexto do handshake pode estar velho): sessão ativa, usuário não
   * suspenso, papel e ao menos uma permissão de equipe, e vínculo atual com o estabelecimento.
   */
  private async canJoinStaffRoom(auth: AuthContext, establishmentId: string) {
    const [session, user] = await Promise.all([
      this.prisma.session.findUnique({ where: { id: auth.sessionId }, select: { revokedAt: true, expiresAt: true } }),
      this.prisma.user.findUnique({
        where: { id: auth.userId },
        select: {
          status: true,
          role: true,
          deletedAt: true,
          _count: { select: { permissions: true } },
          memberships: { where: { establishmentId }, select: { userId: true } },
        },
      }),
    ]);
    return Boolean(
      session &&
        !session.revokedAt &&
        session.expiresAt > new Date() &&
        user &&
        user.status === 'active' &&
        !user.deletedAt &&
        STAFF_ROLES.includes(user.role) &&
        user._count.permissions > 0 &&
        user.memberships.length > 0,
    );
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
