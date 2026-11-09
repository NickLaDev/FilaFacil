import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import AccessBlocked from '@/components/layout/AccessBlocked';
import Toast from '@/components/ui/Toast';
import { QR_LINK_PARAM } from '@/services/floorService';
import { useToast } from '@/components/ui/useToast';
import { onSessionEvent } from '@/lib/api/client';
import { handleSessionExpired, logout, OAUTH_ERROR_MESSAGES, useMe } from '@/services/authService';
import { ClientContext, useClient, type ClientAccount, type ClientContextValue } from './clientContext';
import { BOTTOM_NAV_SCREENS } from './navigation';
import BottomNav from './components/BottomNav';
import { useClientOrders } from './hooks/useOrders';
import { useQrResolver } from './hooks/useQrResolver';
import type { CartLine, ClientScreen, SignupDraft, TableContext, VerificationRequest } from './types';
import { SplashScreen, WelcomeScreen } from './screens/EntryScreens';
import { LoginScreen, VerifyCodeScreen } from './screens/LoginScreens';
import ForgotPasswordScreen from './screens/ForgotPasswordScreen';
import { AccountCreatedScreen, SignupContactScreen, SignupNameScreen, SignupTermsScreen } from './screens/SignupScreens';
import { BarClosedScreen, BarConfirmScreen, ManualCodeScreen, QRAuthSheet, QRInvalidScreen, QRScannerScreen } from './screens/QRScreens';
import LocationScreen from './screens/LocationScreen';
import ExploreScreen from './screens/ExploreScreen';
import RestaurantDetailScreen from './screens/RestaurantDetailScreen';
import { HomeInBarScreen, HomeOutOfBarScreen } from './screens/HomeScreens';
import { ItemDetailScreen, MenuScreen } from './screens/MenuScreens';
import { CartScreen, OrderConfirmedScreen, PaymentScreen } from './screens/CheckoutScreens';
import { OrderTrackingScreen, OrdersScreen, ReceiptScreen } from './screens/OrderScreens';
import { AddressesScreen, EditProfileScreen, ProfileScreen, ReservationsScreen } from './screens/ProfileScreens';
import { AccountSecurityScreen, DeleteAccountScreen } from './screens/AccountScreens';
import { ClubScreen } from './screens/ClubScreen';
import { BookingScreen, CashbackScreen, DietaryScreen, NotificationsScreen, PaymentMethodsScreen, ReviewScreen } from './screens/Sprint4Screens';
import OnboardingScreen from './screens/OnboardingScreen';
import { REALTIME_EVENTS } from '@filafacil/shared';
import { useUserRealtime } from '@/lib/realtime';
import { completeOnboarding, useOnboarding } from '@/services/clientExtrasService';
import { errorMessage } from '@/lib/api/client';
import { queryClient } from '@/lib/api/queryClient';
import { recordShareVisit, SHARE_LINK_PARAM, SHARE_SOURCE_PARAM } from '@/services/sprint4Service';

const EMPTY_SIGNUP: SignupDraft = { name: '', cpf: '', email: '', phone: '', password: '' };
const MAX_LINE_QUANTITY = 20;

const SCREENS: Record<ClientScreen, () => ReactNode> = {
  splash: () => <SplashScreen />,
  welcome: () => <WelcomeScreen />,
  login: () => <LoginScreen />,
  'verify-code': () => <VerifyCodeScreen />,
  'forgot-password': () => <ForgotPasswordScreen />,
  'signup-name': () => <SignupNameScreen />,
  'signup-contact': () => <SignupContactScreen />,
  'signup-terms': () => <SignupTermsScreen />,
  'account-created': () => <AccountCreatedScreen />,
  'qr-scanner': () => <QRScannerScreen />,
  'manual-code': () => <ManualCodeScreen />,
  'qr-invalid': () => <QRInvalidScreen />,
  'bar-closed': () => <BarClosedScreen />,
  'bar-confirm': () => <BarConfirmScreen />,
  'qr-auth-sheet': () => <QRAuthSheet />,
  location: () => <LocationScreen />,
  explore: () => <ExploreScreen />,
  favorites: () => <ExploreScreen key="favorites" initialFilter="Favoritos" />,
  'restaurant-detail': () => <RestaurantDetailScreen />,
  'home-out-of-bar': () => <HomeOutOfBarScreen />,
  'home-in-bar': () => <HomeInBarScreen />,
  menu: () => <MenuScreen />,
  'item-detail': () => <ItemDetailScreen />,
  cart: () => <CartScreen />,
  payment: () => <PaymentScreen />,
  'order-confirmed': () => <OrderConfirmedScreen />,
  orders: () => <OrdersScreen />,
  reservations: () => <ReservationsScreen />,
  'order-tracking': () => <OrderTrackingScreen />,
  receipt: () => <ReceiptScreen />,
  profile: () => <ProfileScreen />,
  club: () => <ClubScreen />,
  cashback: () => <CashbackScreen />,
  'payment-methods': () => <PaymentMethodsScreen />,
  dietary: () => <DietaryScreen />,
  notifications: () => <NotificationsScreen />,
  booking: () => <BookingScreen />,
  review: () => <ReviewScreen />,
  'edit-profile': () => <EditProfileScreen />,
  addresses: () => <AddressesScreen />,
  'account-security': () => <AccountSecurityScreen />,
  'delete-account': () => <DeleteAccountScreen />,
};

/** Telas que exigem conta; visitante/deslogado cai no login. */
const ACCOUNT_SCREENS = new Set<ClientScreen>(['payment', 'order-confirmed', 'receipt', 'edit-profile', 'addresses', 'account-security', 'reservations', 'club', 'cashback', 'payment-methods', 'dietary', 'notifications', 'booking', 'review']);

interface LaunchParams {
  oauth: { success: boolean; error: string | null };
  tableCode: string | null;
  /** Ficha 62: link compartilhado da página de um restaurante (?r=<id>&src=<origem>). */
  share: { restaurantId: string; source: string } | null;
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parâmetros de abertura (?auth=…, ?auth_error=…, ?mesa=…) lidos uma única vez por carregamento da página e
 * removidos do endereço. O valor fica guardado porque o React pode descartar a primeira renderização (Suspense)
 * e rodar os inicializadores de novo — com o endereço já limpo, o link da mesa se perderia.
 */
let launchParams: LaunchParams | null = null;
function readLaunchParams(): LaunchParams {
  if (launchParams) return launchParams;
  const params = new URLSearchParams(window.location.search);
  const success = params.get('auth') === 'success';
  const error = params.get('auth_error');
  const tableCode = params.get(QR_LINK_PARAM);
  const sharedId = params.get(SHARE_LINK_PARAM);
  const share = sharedId && UUID_PATTERN.test(sharedId) ? { restaurantId: sharedId, source: params.get(SHARE_SOURCE_PARAM) ?? 'other' } : null;
  if (success || error || tableCode || sharedId) {
    for (const key of ['auth', 'auth_error', QR_LINK_PARAM, SHARE_LINK_PARAM, SHARE_SOURCE_PARAM]) params.delete(key);
    const query = params.toString();
    window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}`);
  }
  launchParams = { oauth: { success, error }, tableCode, share };
  return launchParams;
}

/** Marca os parâmetros como usados: uma montagem posterior do app não repete o link nem o aviso de login. */
function consumeLaunchParams(part: 'oauth' | 'tableCode' | 'share') {
  if (!launchParams) return;
  if (part === 'oauth') launchParams = { ...launchParams, oauth: { success: false, error: null } };
  else if (part === 'share') launchParams = { ...launchParams, share: null };
  else launchParams = { ...launchParams, tableCode: null };
}

/**
 * Link de mesa aberto pela câmera: assim que a sessão é conferida, resolve o código e leva direto à mesa
 * (a vinheta não navega sozinha nesse caso, então nada disputa com essa navegação). Se a API não responder,
 * cai no início normal.
 */
function TableLinkHandler({ code }: { code: string | null }) {
  const { account, sessionLoading } = useClient();
  const { resolve } = useQrResolver();
  const handled = useRef(false);
  useEffect(() => {
    if (!code || sessionLoading || handled.current) return;
    handled.current = true;
    consumeLaunchParams('tableCode');
    void resolve(code, { fallback: account ? 'home-out-of-bar' : 'welcome' });
  }, [code, sessionLoading, account, resolve]);
  return null;
}

/**
 * Link compartilhado da página de um restaurante (ficha 62): registra a origem do acesso (métrica de marketing) e
 * abre a página do restaurante direto — com ou sem conta, sem passar pela vinheta.
 */
function ShareLinkHandler({ link }: { link: { restaurantId: string; source: string } | null }) {
  const { sessionLoading, openEstablishment } = useClient();
  const handled = useRef(false);
  useEffect(() => {
    if (!link || sessionLoading || handled.current) return;
    handled.current = true;
    consumeLaunchParams('share');
    void recordShareVisit(link.restaurantId, link.source);
    openEstablishment(link.restaurantId);
  }, [link, sessionLoading, openEstablishment]);
  return null;
}

export default function ClientApp() {
  const me = useMe();
  const user = me.data?.user ?? null;
  const account: ClientAccount | null = user;
  const [suspended, setSuspended] = useState(false);
  const [oauthResult] = useState(() => readLaunchParams().oauth);
  const [tableLink] = useState(() => readLaunchParams().tableCode);
  const [shareLink] = useState(() => readLaunchParams().share);
  const { toastMessage, showToast } = useToast();

  const [screen, setScreen] = useState<ClientScreen>(oauthResult.success ? 'home-out-of-bar' : oauthResult.error ? 'login' : 'splash');
  const [isVisitor, setIsVisitor] = useState(false);
  const [postAuthScreen, setPostAuthScreen] = useState<ClientScreen | null>(null);
  const [table, setTableState] = useState<TableContext | null>(null);
  const [establishmentId, setEstablishmentId] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [cart, setCart] = useState<CartLine[]>([]);
  const [cartEstablishmentId, setCartEstablishmentId] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [verification, setVerification] = useState<VerificationRequest | null>(null);
  const [signupDraft, setSignupDraft] = useState<SignupDraft>(EMPTY_SIGNUP);

  const [readyOrderId, setReadyOrderId] = useState<string | null>(null);
  const [onboardingClosed, setOnboardingClosed] = useState(false);
  const announcedReady = useRef(new Set<string>());
  const onboarding = useOnboarding(Boolean(account));

  const go = useCallback((next: ClientScreen) => {
    setScreen(next);
    window.scrollTo(0, 0);
  }, []);

  useEffect(() => {
    if (oauthResult.error) showToast(OAUTH_ERROR_MESSAGES[oauthResult.error] ?? 'Não foi possível entrar. Tente novamente.');
    else if (oauthResult.success) showToast('Login realizado');
    consumeLaunchParams('oauth');
  }, [oauthResult, showToast]);

  // Suspensão (ficha 36) e sessão revogada chegam pela API ou pelo WebSocket na hora.
  useEffect(
    () =>
      onSessionEvent(event => {
        if (event === 'suspended') setSuspended(true);
        else handleSessionExpired();
      }),
    [],
  );

  // Ficha 05: aviso in-app quando o pedido fica pronto (um aviso por pedido, mesmo se o evento chegar repetido).
  useUserRealtime(
    [REALTIME_EVENTS.orderReady],
    payload => {
      const id = payload?.orderId;
      if (!id || announcedReady.current.has(id)) return;
      announcedReady.current.add(id);
      setReadyOrderId(id);
      showToast('Seu pedido está pronto!');
    },
    Boolean(account),
  );

  // Aviso in-app novo (reserva, pedido para avaliar…): um toast discreto; a lista fica em Perfil → Notificações.
  useUserRealtime([REALTIME_EVENTS.notificationsUpdated], () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }), Boolean(account));

  const finishOnboarding = useCallback(
    async (skipped: boolean) => {
      setOnboardingClosed(true);
      try {
        await completeOnboarding(skipped);
      } catch (error) {
        showToast(errorMessage(error));
      }
    },
    [showToast],
  );

  const signOut = useCallback(async () => {
    setSuspended(false);
    await logout();
  }, []);

  const value = useMemo<ClientContextValue>(() => ({
    screen,
    go,
    showToast,
    account,
    sessionLoading: me.isPending,
    deepLink: tableLink !== null || shareLink !== null,
    signOut,
    isVisitor: isVisitor && !account,
    continueAsVisitor: destination => {
      setIsVisitor(true);
      go(destination);
    },
    setPostAuthScreen,
    finishAuth: () => {
      setIsVisitor(false);
      setSignupDraft(EMPTY_SIGNUP);
      go(postAuthScreen ?? (table ? 'home-in-bar' : 'home-out-of-bar'));
      setPostAuthScreen(null);
    },
    table,
    setTable: next => {
      setTableState(next);
      if (next) setEstablishmentId(next.establishmentId);
    },
    establishmentId,
    openEstablishment: id => {
      setEstablishmentId(id);
      go('restaurant-detail');
    },
    openMenu: id => {
      setEstablishmentId(id);
      go('menu');
    },
    selectedItemId,
    openItem: itemId => {
      setSelectedItemId(itemId);
      go('item-detail');
    },
    cart,
    cartEstablishmentId,
    addToCart: (targetEstablishmentId, line) => {
      setCartEstablishmentId(targetEstablishmentId);
      setCart(prev => {
        // Carrinho é de um estabelecimento só; itens iguais com a mesma observação somam.
        const base = cartEstablishmentId === targetEstablishmentId ? prev : [];
        const existing = base.findIndex(l => l.itemId === line.itemId && l.notes === line.notes);
        if (existing === -1) return [...base, line];
        return base.map((l, index) => (index === existing ? { ...l, quantity: Math.min(MAX_LINE_QUANTITY, l.quantity + line.quantity) } : l));
      });
    },
    changeCartQuantity: (index, delta) =>
      setCart(prev =>
        prev
          .map((line, i) => (i === index ? { ...line, quantity: Math.min(MAX_LINE_QUANTITY, line.quantity + delta) } : line))
          .filter(line => line.quantity > 0),
      ),
    removeCartLine: index => setCart(prev => prev.filter((_, i) => i !== index)),
    clearCart: () => {
      setCart([]);
      setCartEstablishmentId(null);
    },
    orderId,
    openOrder: (id, next = 'order-tracking') => {
      setOrderId(id);
      go(next);
    },
    verification,
    requestVerification: request => {
      setVerification(request);
      go('verify-code');
    },
    signupDraft,
    setSignupDraft,
  }), [screen, go, showToast, account, me.isPending, tableLink, shareLink, signOut, isVisitor, postAuthScreen, table, establishmentId, selectedItemId, cart, cartEstablishmentId, orderId, verification, signupDraft]);

  if (suspended) {
    return (
      <AccessBlocked
        title="Conta suspensa"
        description="Sua conta foi suspensa pela administração da plataforma. Fale com o suporte para mais informações."
        action={{ label: 'Sair', onClick: () => void signOut().then(() => go('welcome')) }}
      />
    );
  }

  const activeScreen: ClientScreen = ACCOUNT_SCREENS.has(screen) && !account ? 'login' : screen;

  return (
    <ClientContext.Provider value={value}>
      <div className="relative min-h-screen">
        <Toast message={toastMessage} />
        <TableLinkHandler code={tableLink} />
        <ShareLinkHandler link={shareLink} />
        {readyOrderId && activeScreen !== 'order-tracking' && (
          <div role="status" data-testid="order-ready-banner" className="fixed top-0 inset-x-0 z-50 bg-success text-white px-4 py-3 flex items-center gap-3 shadow-lg">
            <span className="flex-1 text-sm font-semibold">🎉 Seu pedido está pronto! Retire no balcão.</span>
            <button onClick={() => { value.openOrder(readyOrderId); setReadyOrderId(null); }} className="text-xs font-bold bg-white/20 rounded-lg px-3 py-1.5">Ver pedido</button>
            <button onClick={() => setReadyOrderId(null)} aria-label="Fechar aviso" className="text-white/80 text-lg leading-none">×</button>
          </div>
        )}
        {SCREENS[activeScreen]()}
        {account && onboarding.data && !onboarding.data.completed && !onboardingClosed && (activeScreen === 'home-out-of-bar' || activeScreen === 'home-in-bar') && (
          <OnboardingScreen onFinish={skipped => void finishOnboarding(skipped)} />
        )}
        {BOTTOM_NAV_SCREENS.has(activeScreen) && <ClientBottomNav screen={activeScreen} />}
      </div>
    </ClientContext.Provider>
  );
}

function ClientBottomNav({ screen }: { screen: ClientScreen }) {
  const { go, table } = useClient();
  const { active } = useClientOrders();
  return <BottomNav activeScreen={screen} onNavigate={go} hasActiveOrder={Boolean(active)} inBar={Boolean(table)} />;
}
