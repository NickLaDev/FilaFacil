import { createContext, useContext } from 'react';
import type { AuthUser } from '@filafacil/shared';
import type { CartLine, ClientScreen, SignupDraft, TableContext, VerificationRequest } from './types';

/** Conta do cliente vinda da API (`emailVerified`/`phoneVerified` são gravados pelo servidor). */
export type ClientAccount = AuthUser;

export const isAccountVerified = (account: ClientAccount) => account.emailVerified || account.phoneVerified;

export interface ClientContextValue {
  screen: ClientScreen;
  go: (screen: ClientScreen) => void;
  showToast: (message: string) => void;

  account: ClientAccount | null;
  /** Sessão ainda sendo conferida na API (a splash espera antes de decidir a próxima tela). */
  sessionLoading: boolean;
  /** App aberto por link de mesa (/?mesa=): a abertura não deve atrasar o cardápio. */
  deepLink: boolean;
  signOut: () => Promise<void>;
  isVisitor: boolean;
  continueAsVisitor: (destination: ClientScreen) => void;
  /** Para onde voltar depois de login/cadastro (ex.: carrinho, mesa do QR). */
  setPostAuthScreen: (screen: ClientScreen) => void;
  finishAuth: () => void;

  table: TableContext | null;
  setTable: (table: TableContext | null) => void;
  /** Estabelecimento aberto na página de detalhes / cardápio. */
  establishmentId: string | null;
  openEstablishment: (id: string) => void;
  openMenu: (establishmentId: string) => void;

  selectedItemId: string | null;
  openItem: (itemId: string) => void;
  cart: CartLine[];
  cartEstablishmentId: string | null;
  addToCart: (establishmentId: string, line: CartLine) => void;
  changeCartQuantity: (index: number, delta: number) => void;
  removeCartLine: (index: number) => void;
  clearCart: () => void;

  orderId: string | null;
  openOrder: (orderId: string, screen?: ClientScreen) => void;

  verification: VerificationRequest | null;
  requestVerification: (request: VerificationRequest) => void;
  signupDraft: SignupDraft;
  setSignupDraft: (draft: SignupDraft) => void;
}

export const ClientContext = createContext<ClientContextValue | null>(null);

export function useClient() {
  const context = useContext(ClientContext);
  if (!context) throw new Error('useClient deve ser usado dentro do ClientApp');
  return context;
}
