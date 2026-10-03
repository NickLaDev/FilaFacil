import { useCallback, useMemo, useState, type ReactNode } from 'react';
import AccessBlocked from '@/components/layout/AccessBlocked';
import Toast from '@/components/ui/Toast';
import { useToast } from '@/components/ui/useToast';
import { logout, useCurrentAccount } from '@/services/authService';
import { useIsSuspended } from '@/services/platformUserService';
import { ClientContext, useClient, type ClientContextValue } from './clientContext';
import { BOTTOM_NAV_SCREENS } from './navigation';
import BottomNav from './components/BottomNav';
import { useClientOrders } from './hooks/useOrders';
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
import { AddressesScreen, EditProfileScreen, ProfileScreen } from './screens/ProfileScreens';
import { AccountSecurityScreen, DeleteAccountScreen } from './screens/AccountScreens';

const EMPTY_SIGNUP: SignupDraft = { name: '', cpf: '', email: '', phone: '' };
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
  'order-tracking': () => <OrderTrackingScreen />,
  receipt: () => <ReceiptScreen />,
  profile: () => <ProfileScreen />,
  'edit-profile': () => <EditProfileScreen />,
  addresses: () => <AddressesScreen />,
  'account-security': () => <AccountSecurityScreen />,
  'delete-account': () => <DeleteAccountScreen />,
};

/** Telas que exigem conta; visitante/deslogado cai no login. */
const ACCOUNT_SCREENS = new Set<ClientScreen>(['payment', 'order-confirmed', 'receipt', 'edit-profile', 'addresses', 'account-security']);

export default function ClientApp() {
  const account = useCurrentAccount();
  const suspended = useIsSuspended({ email: account?.email || account?.phone || '__none__' });
  const { toastMessage, showToast } = useToast();

  const [screen, setScreen] = useState<ClientScreen>('splash');
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

  const go = useCallback((next: ClientScreen) => {
    setScreen(next);
    window.scrollTo(0, 0);
  }, []);

  const value = useMemo<ClientContextValue>(() => ({
    screen,
    go,
    showToast,
    account,
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
  }), [screen, go, showToast, account, isVisitor, postAuthScreen, table, establishmentId, selectedItemId, cart, cartEstablishmentId, orderId, verification, signupDraft]);

  if (account && suspended) {
    return (
      <AccessBlocked
        title="Conta suspensa"
        description="Sua conta foi suspensa pela administração da plataforma. Fale com o suporte para mais informações."
        action={{ label: 'Sair', onClick: () => { logout(); go('welcome'); } }}
      />
    );
  }

  const activeScreen: ClientScreen = ACCOUNT_SCREENS.has(screen) && !account ? 'login' : screen;

  return (
    <ClientContext.Provider value={value}>
      <div className="relative min-h-screen">
        <Toast message={toastMessage} />
        {SCREENS[activeScreen]()}
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
