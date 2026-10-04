import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { CLIENT_HEADER } from '@filafacil/shared';
import { AppModule } from '../../src/app.module.js';
import { AppConfig } from '../../src/config/app-config.js';
import { PrismaService } from '../../src/database/prisma.service.js';
import { OAUTH_PROVIDERS, type OAuthProviderClient, type OAuthProviderId } from '../../src/modules/auth/oauth/oauth-provider.js';
import { EmailSender, SmsSender } from '../../src/modules/notifications/message-senders.js';
import { setupApp } from '../../src/setup-app.js';

/** Header anti-CSRF exigido em POST/PUT/PATCH/DELETE. */
export const CSRF = { [CLIENT_HEADER.name]: CLIENT_HEADER.value };

/** Provider de envio que guarda as mensagens para o teste ler o código enviado. */
export class CapturingSender {
  readonly provider = 'test';
  available = true;
  readonly messages: { destination: string; message: string }[] = [];

  async send(destination: string, _masked: string, message: string) {
    this.messages.push({ destination, message });
  }

  lastCode(destination: string) {
    const message = [...this.messages].reverse().find(entry => entry.destination === destination)?.message ?? '';
    return /(\d{6})/.exec(message)?.[1] ?? null;
  }
}

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  sms: CapturingSender;
  port: number;
  /** Cliente HTTP com cookie jar próprio (cada um é um "navegador"). */
  browser: () => ReturnType<typeof request.agent>;
  close: () => Promise<void>;
}

export async function createTestApp(oauthProviders = new Map<OAuthProviderId, OAuthProviderClient>()): Promise<TestApp> {
  const sms = new CapturingSender();
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SmsSender)
    .useValue(sms)
    .overrideProvider(EmailSender)
    .useValue(new CapturingSender())
    .overrideProvider(OAUTH_PROVIDERS)
    .useValue(oauthProviders)
    .compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: process.env.TEST_LOGS === 'true' ? ['error', 'warn'] : false });
  setupApp(app, app.get(AppConfig));
  // Escutando numa porta real: supertest reutiliza o servidor e o Socket.IO fica acessível.
  await app.listen(0);
  return {
    app,
    port: (app.getHttpServer().address() as AddressInfo).port,
    prisma: app.get(PrismaService),
    sms,
    browser: () => request.agent(app.getHttpServer()),
    close: () => app.close(),
  };
}
