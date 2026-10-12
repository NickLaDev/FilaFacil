import { createHmac } from 'node:crypto';
import type { Env } from '../../config/env.js';
import { mapMercadoPagoStatus, MercadoPagoGateway } from './mercado-pago.gateway.js';

const SECRET = 'segredo-do-webhook-de-teste';
const gateway = new MercadoPagoGateway({ MP_WEBHOOK_SECRET: SECRET, MP_ACCESS_TOKEN: 'TEST-token' } as Env);
const sign = (dataId: string, requestId: string, ts = '1700000000') =>
  `ts=${ts},v1=${createHmac('sha256', SECRET).update(`id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`).digest('hex')}`;

describe('assinatura do webhook do Mercado Pago', () => {
  it('aceita a assinatura calculada com o segredo', () => {
    expect(gateway.verifyWebhook({ dataId: 'ABC123', requestId: 'req-1', signature: sign('ABC123', 'req-1') })).toBe(true);
  });

  it('recusa assinatura errada, de outro pagamento, outra requisição ou sem campos', () => {
    const valid = sign('123', 'req-1');
    expect(gateway.verifyWebhook({ dataId: '124', requestId: 'req-1', signature: valid })).toBe(false);
    expect(gateway.verifyWebhook({ dataId: '123', requestId: 'req-2', signature: valid })).toBe(false);
    expect(gateway.verifyWebhook({ dataId: '123', requestId: 'req-1', signature: 'ts=1700000000,v1=00' })).toBe(false);
    expect(gateway.verifyWebhook({ dataId: '123', requestId: 'req-1', signature: undefined })).toBe(false);
    expect(gateway.verifyWebhook({ dataId: undefined, requestId: 'req-1', signature: valid })).toBe(false);
    expect(gateway.verifyWebhook({ dataId: '123', requestId: 'req-1', signature: 'lixo' })).toBe(false);
  });

  it('sem segredo configurado nenhuma notificação é aceita', () => {
    const open = new MercadoPagoGateway({ MP_WEBHOOK_SECRET: '' } as Env);
    expect(open.verifyWebhook({ dataId: '1', requestId: 'r', signature: sign('1', 'r') })).toBe(false);
  });
});

describe('status do Mercado Pago', () => {
  it('só aprova com "approved"; estados em análise continuam pendentes', () => {
    expect(mapMercadoPagoStatus('approved')).toBe('approved');
    for (const status of ['pending', 'in_process', 'authorized', 'in_mediation']) expect(mapMercadoPagoStatus(status)).toBe('pending');
    expect(mapMercadoPagoStatus('rejected', 'cc_rejected_other_reason')).toBe('refused');
    expect(mapMercadoPagoStatus('cancelled', 'expired')).toBe('expired');
    expect(mapMercadoPagoStatus('cancelled')).toBe('cancelled');
    expect(mapMercadoPagoStatus('refunded')).toBe('refunded');
    expect(mapMercadoPagoStatus('algo_novo')).toBe('pending');
  });
});
