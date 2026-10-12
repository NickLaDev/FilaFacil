import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AllExceptionsFilter } from './common/http/all-exceptions.filter.js';
import { createValidationPipe } from './common/http/validation.pipe.js';
import { CsrfGuard } from './common/security/csrf.guard.js';
import { ConfigModule } from './config/config.module.js';
import { DatabaseModule } from './database/database.module.js';
import { AccessModule } from './modules/access/access.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { AccessTokenGuard } from './modules/auth/access-token.guard.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { EstablishmentsModule } from './modules/establishments/establishments.module.js';
import { FavoritesModule } from './modules/favorites/favorites.module.js';
import { FloorPlanModule } from './modules/floor-plan/floor-plan.module.js';
import { HealthController } from './modules/health/health.controller.js';
import { MeModule } from './modules/me/me.module.js';
import { MenuModule } from './modules/menu/menu.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { OrdersModule } from './modules/orders/orders.module.js';
import { PromotionsModule } from './modules/promotions/promotions.module.js';
import { RealtimeGatewayModule } from './modules/realtime/realtime-gateway.module.js';
import { RealtimeModule } from './modules/realtime/realtime.module.js';
import { RestaurantsModule } from './modules/restaurants/restaurants.module.js';
import { StorageModule } from './modules/storage/storage.module.js';
import { TablesModule } from './modules/tables/tables.module.js';
import { TechnicalSheetsModule } from './modules/technical-sheets/technical-sheets.module.js';
import { WaitlistModule } from './modules/waitlist/waitlist.module.js';

@Module({
  imports: [
    ConfigModule,
    DatabaseModule,
    RealtimeModule,
    NotificationsModule,
    StorageModule,
    AccessModule,
    // Limite geral: por usuário quando há sessão válida e por IP nas demais requisições. Clientes no Wi-Fi
    // de um mesmo bar compartilham o IP público, então o IP sozinho bloquearia quem está logado. Rotas de
    // autenticação têm limites próprios (@Throttle) e, sem sessão, continuam contadas por IP.
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'default',
          ttl: 60_000,
          limit: 600,
          getTracker: (request: { auth?: { userId: string }; ip?: string }) => (request.auth ? `user:${request.auth.userId}` : (request.ip ?? 'unknown')),
        },
      ],
      // Interruptor só para testes/desenvolvimento: ignorado em produção.
      skipIf: () => process.env.THROTTLE_DISABLED === 'true' && process.env.NODE_ENV !== 'production',
    }),
    AuthModule,
    MeModule,
    RealtimeGatewayModule,
    RestaurantsModule,
    FavoritesModule,
    EstablishmentsModule,
    MenuModule,
    PromotionsModule,
    TechnicalSheetsModule,
    FloorPlanModule,
    WaitlistModule,
    TablesModule,
    OrdersModule,
    AdminModule,
  ],
  controllers: [HealthController],
  providers: [
    // Ordem importa: CSRF → sessão → rate limit (o limite por usuário precisa da sessão já resolvida;
    // requisições sem cookie válido seguem para o limite por IP sem consulta ao banco).
    { provide: APP_GUARD, useClass: CsrfGuard },
    { provide: APP_GUARD, useClass: AccessTokenGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_PIPE, useFactory: createValidationPipe },
  ],
})
export class AppModule {}
