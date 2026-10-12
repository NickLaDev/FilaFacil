import { Logger, Module } from '@nestjs/common';
import { AppConfig } from '../../config/app-config.js';
import { PrismaService } from '../../database/prisma.service.js';
import { MercadoPagoGateway } from './mercado-pago.gateway.js';
import { DisabledPaymentGateway, PaymentGateway } from './payment-gateway.js';
import { SimulatedPaymentGateway } from './simulated-payment.gateway.js';

@Module({
  providers: [
    {
      provide: PaymentGateway,
      inject: [AppConfig, PrismaService],
      useFactory: (config: AppConfig, prisma: PrismaService): PaymentGateway => {
        switch (config.env.PAYMENT_PROVIDER) {
          case 'mercadopago':
            return new MercadoPagoGateway(config.env);
          case 'simulated':
            // Defesa em profundidade: o schema do .env já recusa, mas o gateway nunca é criado fora de demo.
            if (config.isProduction || !config.env.ALLOW_SIMULATED_PAYMENTS) {
              throw new Error('Pagamento simulado recusado: só roda fora de produção com ALLOW_SIMULATED_PAYMENTS=true.');
            }
            new Logger('Payments').warn('PAGAMENTO SIMULADO ATIVO: nenhuma transação tem valor financeiro. Uso exclusivo de demonstração.');
            return new SimulatedPaymentGateway(prisma);
          default:
            return new DisabledPaymentGateway();
        }
      },
    },
  ],
  exports: [PaymentGateway],
})
export class PaymentsModule {}
