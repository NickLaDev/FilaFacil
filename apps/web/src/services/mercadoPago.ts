import type { PaymentMethod } from '@filafacil/shared';
import { onlyDigits } from '@/lib/validation';

/** Dados do cartão digitados na tela. Existem só em memória: vão direto ao Mercado Pago e viram um token. */
export interface CardInput {
  number: string;
  holder: string;
  expiry: string;
  cvv: string;
  /** CPF do titular, exigido pelo Mercado Pago no Brasil. */
  cpf: string;
}

interface MercadoPagoClient {
  getPaymentMethods(options: { bin: string }): Promise<{ results: { id: string; payment_type_id: string }[] }>;
  createCardToken(data: {
    cardNumber: string;
    cardholderName: string;
    cardExpirationMonth: string;
    cardExpirationYear: string;
    securityCode: string;
    identificationType: string;
    identificationNumber: string;
  }): Promise<{ id: string }>;
}

declare global {
  interface Window {
    MercadoPago?: new (publicKey: string, options?: { locale: string }) => MercadoPagoClient;
  }
}

const SDK_URL = 'https://sdk.mercadopago.com/js/v2';
const PUBLIC_KEY = import.meta.env.VITE_MP_PUBLIC_KEY ?? '';

/** Cartão só funciona com a chave pública configurada; o Pix independe dela. */
export const isCardPaymentConfigured = Boolean(PUBLIC_KEY);

/** Erro explicável ao cliente (cartão inválido, não aceito, SDK indisponível). */
export class CardError extends Error {}

let sdk: Promise<MercadoPagoClient> | null = null;

function loadSdk() {
  sdk ??= new Promise<MercadoPagoClient>((resolve, reject) => {
    const start = () => (window.MercadoPago ? resolve(new window.MercadoPago(PUBLIC_KEY, { locale: 'pt-BR' })) : reject(new Error('SDK ausente')));
    if (window.MercadoPago) return start();
    const script = document.createElement('script');
    script.src = SDK_URL;
    script.async = true;
    script.onload = start;
    script.onerror = () => reject(new Error('SDK indisponível'));
    document.head.appendChild(script);
  }).catch(error => {
    sdk = null;
    throw error;
  });
  return sdk;
}

/**
 * Troca os dados do cartão por um token de uso único direto com o Mercado Pago (o servidor nunca vê o
 * número). Devolve também a bandeira/tipo que a API de pagamentos exige.
 */
export async function tokenizeCard(card: CardInput, method: Exclude<PaymentMethod, 'pix'>) {
  if (!isCardPaymentConfigured) throw new CardError('O pagamento com cartão não está disponível neste ambiente.');
  let client: MercadoPagoClient;
  try {
    client = await loadSdk();
  } catch {
    throw new CardError('Não foi possível carregar o pagamento com cartão. Verifique sua conexão.');
  }
  const number = onlyDigits(card.number);
  const wantedType = method === 'credit' ? 'credit_card' : 'debit_card';
  try {
    const { results } = await client.getPaymentMethods({ bin: number.slice(0, 8) });
    const paymentMethod = results.find(result => result.payment_type_id === wantedType);
    if (!paymentMethod) throw new CardError(method === 'credit' ? 'Este cartão não aceita crédito.' : 'Este cartão não aceita débito.');
    const [month = '', year = ''] = card.expiry.split('/');
    const token = await client.createCardToken({
      cardNumber: number,
      cardholderName: card.holder,
      cardExpirationMonth: month,
      cardExpirationYear: year.length === 2 ? `20${year}` : year,
      securityCode: card.cvv,
      identificationType: 'CPF',
      identificationNumber: onlyDigits(card.cpf),
    });
    return { cardToken: token.id, paymentMethodId: paymentMethod.id };
  } catch (error) {
    if (error instanceof CardError) throw error;
    throw new CardError('Não foi possível validar o cartão. Confira os dados e tente novamente.');
  }
}
