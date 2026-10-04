import type { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { CLIENT_HEADER } from '@filafacil/shared';
import type { AppConfig } from './config/app-config.js';
import { ACCESS_COOKIE } from './modules/auth/auth-cookies.js';
import { RealtimeIoAdapter } from './modules/realtime/realtime-io.adapter.js';
import { FileStorage } from './modules/storage/file-storage.js';
import { LocalFileStorage, UPLOADS_URL_PREFIX } from './modules/storage/local-file-storage.js';

const JSON_BODY_LIMIT = '100kb';
const FORM_BODY_LIMIT = '20kb';

function parseTrustProxy(value: string): boolean | number | string {
  if (value === 'true' || value === 'false') return value === 'true';
  return /^\d+$/.test(value) ? Number(value) : value;
}

/** Middlewares e segurança HTTP compartilhados entre o servidor real e os testes de integração. */
export function setupApp(app: NestExpressApplication, config: AppConfig) {
  app.setGlobalPrefix('api');
  app.set('trust proxy', parseTrustProxy(config.env.TRUST_PROXY));
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cookieParser());
  app.useBodyParser('json', { limit: JSON_BODY_LIMIT });
  app.useBodyParser('urlencoded', { limit: FORM_BODY_LIMIT, extended: false });
  app.enableCors({
    origin: config.env.WEB_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
    allowedHeaders: ['Content-Type', CLIENT_HEADER.name],
  });

  const storage = app.get(FileStorage);
  if (storage instanceof LocalFileStorage) {
    app.useStaticAssets(storage.directory, { prefix: UPLOADS_URL_PREFIX, index: false, dotfiles: 'deny', immutable: true, maxAge: '30d' });
  }

  app.useWebSocketAdapter(new RealtimeIoAdapter(app, config.env.WEB_ORIGIN));
  app.enableShutdownHooks();
}

export function setupSwagger(app: NestExpressApplication) {
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder()
      .setTitle('FilaFacil API')
      .setDescription(
        [
          'API da Sprint 1. Autenticação por cookies HttpOnly (`ff_access` / `ff_refresh`), definidos por /auth/login, /auth/otp/verify e /auth/register.',
          `Métodos que alteram dados exigem o header \`${CLIENT_HEADER.name}: ${CLIENT_HEADER.value}\` (proteção CSRF).`,
          'Erros seguem o formato { statusCode, code, message, details? }. Datas em ISO 8601 (UTC); dinheiro em centavos.',
        ].join('\n\n'),
      )
      .setVersion('0.1.0')
      .addCookieAuth(ACCESS_COOKIE)
      .addApiKey({ type: 'apiKey', in: 'header', name: CLIENT_HEADER.name, description: `Use o valor "${CLIENT_HEADER.value}"` }, 'csrf')
      .addSecurityRequirements('csrf')
      .build(),
  );
  SwaggerModule.setup('api/docs', app, document, {
    jsonDocumentUrl: 'api/docs/openapi.json',
    swaggerOptions: { withCredentials: true, persistAuthorization: true },
  });
}
