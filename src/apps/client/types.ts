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
}

export type VerificationChannel = 'email' | 'phone';

export interface VerificationRequest {
  /** login: entrar por SMS · signup: confirmar contato do cadastro · contact: confirmar depois. */
  purpose: 'login' | 'signup' | 'contact';
  channel: VerificationChannel;
  destination: string;
  returnTo: ClientScreen;
}

export interface SignupDraft {
  name: string;
  cpf: string;
  email: string;
  phone: string;
}
