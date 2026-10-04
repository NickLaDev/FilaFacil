import type { INestApplicationContext } from '@nestjs/common';
import { IoAdapter } from '@nestjs/platform-socket.io';
import type { ServerOptions } from 'socket.io';

export const REALTIME_PATH = '/api/socket.io';

/**
 * Socket.IO sob /api (mesmo proxy do Vite e mesmos cookies). Além do CORS (que só cobre o polling),
 * confere o Origin no handshake para impedir que outro site abra a conexão com os cookies do usuário.
 */
export class RealtimeIoAdapter extends IoAdapter {
  constructor(
    app: INestApplicationContext,
    private readonly allowedOrigin: string,
  ) {
    super(app);
  }

  createIOServer(port: number, options?: ServerOptions) {
    const serverOptions: Partial<ServerOptions> = {
      ...options,
      path: REALTIME_PATH,
      serveClient: false,
      cors: { origin: this.allowedOrigin, credentials: true },
      allowRequest: (request, callback) => {
        const origin = request.headers.origin;
        callback(null, !origin || origin === this.allowedOrigin);
      },
    };
    return super.createIOServer(port, serverOptions as ServerOptions);
  }
}
