import { useEffect, useState } from 'react';
import { Fingerprint } from 'lucide-react';
import { BrandBadge } from '@/components/brand/Logo';
import { formatPhone, isValidEmail, isValidPhone, onlyDigits } from '@/lib/validation';
import {
  findAccountByPhone, loginWithBiometrics, loginWithEmail, loginWithPhone, loginWithProvider,
  loginWithVerifiedEmail, markContactVerified, useDevice, useRememberedAccount,
} from '@/services/authService';
import { isBiometricAvailable, requestBiometricAuth } from '@/services/deviceService';
import { useClient } from '../clientContext';
import { BackButton } from '../components/Layout';
import { LoadingButton, PasswordField, SocialButton, TextField } from '../components/AuthFields';
import CodeVerification from '../components/CodeVerification';

/** Até aqui o cliente entra em poucas tentativas, por qualquer método (ficha 06). */
export function LoginScreen() {
  const { go, finishAuth, requestVerification } = useClient();
  const [step, setStep] = useState<'identify' | 'password'>('identify');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState<'continue' | 'password' | 'google' | 'apple' | 'biometric' | null>(null);
  const isPhone = /^[\d\s()+-]+$/.test(identifier) && onlyDigits(identifier).length > 3;

  function handleContinue() {
    setError('');
    if (isPhone) {
      if (!isValidPhone(identifier)) return setError('Digite um celular válido com DDD.');
      if (!findAccountByPhone(identifier)) return setError('Não encontramos uma conta com esse celular.');
      requestVerification({ purpose: 'login', channel: 'phone', destination: formatPhone(identifier), returnTo: 'login' });
      return;
    }
    if (!isValidEmail(identifier)) return setError('Digite um e-mail ou celular válido.');
    setStep('password');
  }

  async function handlePasswordLogin() {
    setLoading('password');
    const account = await loginWithEmail(identifier, password);
    setLoading(null);
    if (!account) return setError('E-mail ou senha incorretos.');
    finishAuth();
  }

  async function handleProvider(provider: 'google' | 'apple') {
    setLoading(provider);
    const account = await loginWithProvider(provider);
    setLoading(null);
    if (account) finishAuth();
    else setError(`Não foi possível entrar com ${provider === 'google' ? 'Google' : 'Apple'}. Tente novamente.`);
  }

  if (step === 'password') {
    return (
      <div className="min-h-screen bg-background flex flex-col">
        <div className="px-5 pt-5">
          <BackButton onClick={() => { setStep('identify'); setError(''); setPassword(''); }} />
        </div>
        <div className="flex-1 flex flex-col px-6 py-6 gap-6">
          <h1 className="font-display font-bold text-foreground text-2xl">Entrar com e-mail</h1>
          <div className="flex flex-col gap-4">
            <TextField label="E-mail" value={identifier} onChange={setIdentifier} type="email" autoComplete="email" />
            <PasswordField label="Senha" value={password} onChange={value => { setPassword(value); setError(''); }} error={error || undefined} />
          </div>
          <button onClick={() => go('forgot-password')} className="text-primary text-sm font-medium text-left">Esqueci minha senha</button>
          <div className="flex flex-col gap-3 mt-auto">
            <LoadingButton loading={loading === 'password'} disabled={password.length < 1} onClick={handlePasswordLogin}>Entrar</LoadingButton>
            <button
              onClick={() => requestVerification({ purpose: 'login', channel: 'email', destination: identifier.trim(), returnTo: 'login' })}
              className="text-center text-sm text-muted-foreground"
            >
              Entrar usando código por e-mail
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="px-5 pt-5 flex items-center justify-between">
        <BackButton onClick={() => go('welcome')} />
        <BrandBadge />
        <div className="w-8" />
      </div>
      <div className="flex-1 flex flex-col px-6 py-6 gap-5">
        <div>
          <h1 className="font-display font-bold text-foreground text-2xl">Entre na sua conta</h1>
          <p className="text-muted-foreground text-sm mt-1">Continue de onde parou e acompanhe seus pedidos.</p>
        </div>

        <BiometricLoginButton loading={loading === 'biometric'} onStart={() => setLoading('biometric')} onFinish={success => {
          setLoading(null);
          if (success) finishAuth();
          else setError('Não foi possível ler a biometria. Tente de novo ou entre com celular/e-mail.');
        }} />

        <TextField
          label="Celular ou e-mail"
          value={identifier}
          onChange={value => { setIdentifier(value); setError(''); }}
          placeholder="(19) 99999-9999 ou nome@email.com"
          autoComplete="username"
          error={error || undefined}
        />

        <div className="flex flex-col gap-3 mt-auto">
          <LoadingButton disabled={!identifier.trim()} onClick={handleContinue}>Continuar</LoadingButton>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">ou</span>
            <div className="flex-1 h-px bg-border" />
          </div>
          <SocialButton provider="google" loading={loading === 'google'} onClick={() => handleProvider('google')} />
          <SocialButton provider="apple" loading={loading === 'apple'} onClick={() => handleProvider('apple')} />
          <p className="text-center text-sm text-muted-foreground">
            Não tem uma conta?{' '}
            <button onClick={() => go('signup-name')} className="text-foreground font-semibold underline underline-offset-2">Criar conta</button>
          </p>
        </div>
      </div>
    </div>
  );
}

/** Atalho opcional: aparece só se a biometria foi ativada no perfil deste aparelho (ficha 59). */
function BiometricLoginButton({ loading, onStart, onFinish }: { loading: boolean; onStart: () => void; onFinish: (success: boolean) => void }) {
  const { biometricAccountId } = useDevice();
  const remembered = useRememberedAccount();
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let active = true;
    isBiometricAvailable().then(result => active && setAvailable(result));
    return () => { active = false; };
  }, []);

  if (!available || !biometricAccountId || remembered?.id !== biometricAccountId) return null;

  async function authenticate() {
    onStart();
    const ok = await requestBiometricAuth();
    onFinish(ok && loginWithBiometrics() !== null);
  }

  return (
    <button
      onClick={authenticate}
      disabled={loading}
      className="w-full flex items-center gap-4 bg-card border border-primary/30 rounded-xl px-4 py-4 text-left disabled:opacity-60"
    >
      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
        <Fingerprint size={20} className={loading ? 'text-primary animate-pulse' : 'text-primary'} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-display font-semibold text-foreground text-sm">{loading ? 'Aguardando biometria…' : 'Entrar com biometria'}</p>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">{remembered.name}</p>
      </div>
    </button>
  );
}

export function VerifyCodeScreen() {
  const { go, verification, account, finishAuth, showToast } = useClient();
  if (!verification) return null;
  const { purpose, channel, destination, returnTo } = verification;
  const channelLabel = channel === 'email' ? 'e-mail' : 'celular';

  function handleVerified() {
    if (purpose === 'login') {
      const loggedIn = channel === 'phone' ? loginWithPhone(destination) : loginWithVerifiedEmail(destination);
      if (loggedIn) finishAuth();
      else {
        showToast('Conta não encontrada');
        go('login');
      }
      return;
    }
    if (account) markContactVerified(account.id, channel);
    showToast(`${channel === 'email' ? 'E-mail' : 'Celular'} verificado`);
    go(returnTo);
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="px-5 pt-5">
        <BackButton onClick={() => go(returnTo === 'account-created' ? 'signup-terms' : returnTo)} />
      </div>
      <div className="flex-1 flex flex-col px-6 py-6 gap-4">
        <h1 className="font-display font-bold text-foreground text-2xl">
          {purpose === 'login' ? 'Digite o código' : `Confirme seu ${channelLabel}`}
        </h1>
        {purpose !== 'login' && (
          <p className="text-sm text-muted-foreground leading-relaxed">
            A confirmação protege sua conta e libera o pagamento pelo app.
          </p>
        )}
        <CodeVerification destination={destination} onVerified={handleVerified} onChangeDestination={purpose === 'login' ? () => go('login') : undefined} />
        {purpose !== 'login' && (
          <button onClick={() => go(returnTo)} className="text-muted-foreground text-sm mt-2 self-start">
            Fazer isso depois
          </button>
        )}
      </div>
    </div>
  );
}
