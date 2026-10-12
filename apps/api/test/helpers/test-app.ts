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
import { PaymentGateway } from '../../src/modules/payments/payment-gateway.js';
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

/** Cliente HTTP com cookie jar (um "navegador"). */
export type Agent = ReturnType<typeof request.agent>;

export interface TestApp {
  app: INestApplication;
  prisma: PrismaService;
  sms: CapturingSender;
  email: CapturingSender;
  port: number;
  /** Cliente HTTP com cookie jar próprio (cada um é um "navegador"). */
  browser: () => Agent;
  close: () => Promise<void>;
}

export async function createTestApp(
  oauthProviders = new Map<OAuthProviderId, OAuthProviderClient>(),
  gateway?: PaymentGateway,
): Promise<TestApp> {
  const sms = new CapturingSender();
  const email = new CapturingSender();
  const builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SmsSender)
    .useValue(sms)
    .overrideProvider(EmailSender)
    .useValue(email)
    .overrideProvider(OAUTH_PROVIDERS)
    .useValue(oauthProviders);
  // Gateway de pagamento de teste (dublê): a API real do Mercado Pago nunca é chamada nos testes.
  const moduleRef = await (gateway ? builder.overrideProvider(PaymentGateway).useValue(gateway) : builder).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ bodyParser: false, logger: process.env.TEST_LOGS === 'true' ? ['error', 'warn'] : false });
  setupApp(app, app.get(AppConfig));
  // Escutando numa porta real: supertest reutiliza o servidor e o Socket.IO fica acessível.
  await app.listen(0);
  return {
    app,
    port: (app.getHttpServer().address() as AddressInfo).port,
    prisma: app.get(PrismaService),
    sms,
    email,
    browser: () => request.agent(app.getHttpServer()),
    close: () => app.close(),
  };
}
