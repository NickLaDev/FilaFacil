import type { OtpChallengeResponse } from '@filafacil/shared';

export type ClientScreen =
  | 'splash' | 'welcome'
  | 'login' | 'verify-code' | 'forgot-password'
  | 'signup-name' | 'signup-contact' | 'signup-terms' | 'account-created'
  | 'qr-scanner' | 'manual-code' | 'qr-invalid' | 'bar-closed' | 'bar-confirm' | 'qr-auth-sheet'
  | 'location' | 'explore' | 'favorites' | 'restaurant-detail'
  | 'home-out-of-bar' | 'home-in-bar'
  | 'menu' | 'item-detail' | 'cart'
  | 'payment' | 'order-confirmed'
  | 'orders' | 'order-tracking' | 'receipt'
  | 'profile' | 'edit-profile' | 'addresses' | 'account-security' | 'delete-account';

/** Mesa vinculada pelo QR Code: todo pedido feito nela já sai associado (ficha 02). */
export interface TableContext {
  establishmentId: string;
  tableId: string;
  tableLabel: string;
}

export interface CartLine {
  itemId: string;
  quantity: number;
  notes: string;
  /** Nome/foto no momento da adição: o item continua identificável se ficar esgotado. */
  name: string;
  image: string | null;
}

export type VerificationChannel = 'email' | 'phone';

export interface VerificationRequest {
  /** login: entrar por código (real) · signup/contact: confirmar contato (Sprint 2, simulado). */
  purpose: 'login' | 'signup' | 'contact';
  channel: VerificationChannel;
  destination: string;
  returnTo: ClientScreen;
  /** Desafio emitido pela API no login por código (contato original para reenviar). */
  login?: { challenge: OtpChallengeResponse; rawDestination: string };
}

export interface SignupDraft {
  name: string;
  cpf: string;
  email: string;
  phone: string;
  /** Só em memória até o envio do cadastro; nunca é persistida no navegador. */
  password: string;
  /** Recusa do servidor (CPF/contato já cadastrado) exibida no passo correspondente. */
  serverError?: { field: 'cpf' | 'contact'; message: string };
}
