import { useEffect, useState } from 'react';
import { Fingerprint } from 'lucide-react';
import type { OtpChannel } from '@filafacil/shared';
import { BrandBadge } from '@/components/brand/Logo';
import { errorMessage, isApiError } from '@/lib/api/client';
import { formatPhone, isValidEmail, isValidPhone, onlyDigits } from '@/lib/validation';
import { markContactVerified, useDevice } from '@/services/accountExtrasService';
import { loginWithEmail, requestLoginCode, startProviderLogin, useAuthProviders, verifyLoginCode } from '@/services/authService';
import { isBiometricAvailable, requestBiometricAuth } from '@/services/deviceService';
import { useClient } from '../clientContext';
import { BackButton } from '../components/Layout';
import { LoadingButton, PasswordField, SocialButton, TextField } from '../components/AuthFields';
import CodeVerification, { type CodeCheck } from '../components/CodeVerification';

const PROVIDER_LABELS = { google: 'Google', apple: 'Apple' } as const;

/** Entra pelo celular (código por SMS), e-mail (senha ou código), Google ou Apple (ficha 06). */
export function LoginScreen() {
  const { go, finishAuth, requestVerification, showToast } = useClient();
  const providers = useAuthProviders();
  const [step, setStep] = useState<'identify' | 'password'>('identify');
  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState<'continue' | 'password' | 'code' | 'biometric' | null>(null);
  const isPhone = /^[\d\s()+-]+$/.test(identifier) && onlyDigits(identifier).length > 3;

  async function sendCode(channel: OtpChannel) {
    setError('');
    setLoading(channel === 'phone' ? 'continue' : 'code');
    try {
      const challenge = await requestLoginCode(channel, identifier);
      requestVerification({
        purpose: 'login',
        channel,
        destination: channel === 'phone' ? formatPhone(identifier) : identifier.trim(),
        returnTo: 'login',
        login: { challenge, rawDestination: identifier },
      });
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setLoading(null);
    }
  }

  function handleContinue() {
    setError('');
    if (isPhone) {
      if (!isValidPhone(identifier)) return setError('Digite um celular válido com DDD.');
      void sendCode('phone');
      return;
    }
    if (!isValidEmail(identifier)) return setError('Digite um e-mail ou celular válido.');
    setStep('password');
  }

  async function handlePasswordLogin() {
    setLoading('password');
    try {
      await loginWithEmail(identifier, password);
      finishAuth();
    } catch (failure) {
      setError(errorMessage(failure));
    } finally {
      setLoading(null);
    }
  }

  function handleProvider(provider: 'google' | 'apple') {
    setError('');
    // Sem credenciais OAuth no servidor, o botão avisa em vez de simular um login.
    if (!providers.data?.[provider]) return setError(`Login com ${PROVIDER_LABELS[provider]} ainda não está disponível.`);
    startProviderLogin(provider);
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
            <LoadingButton loading={loading === 'password'} disabled={password.length < 1} onClick={() => void handlePasswordLogin()}>Entrar</LoadingButton>
            <button onClick={() => void sendCode('email')} disabled={loading !== null} className="text-center text-sm text-muted-foreground disabled:opacity-50">
              {loading === 'code' ? 'Enviando código…' : 'Entrar usando código por e-mail'}
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

        <BiometricLoginButton
          loading={loading === 'biometric'}
          onStart={() => setLoading('biometric')}
          onFinish={() => {
            setLoading(null);
            showToast('O login por biometria chega com o backend da Sprint 2. Entre com celular ou e-mail.');
          }}
        />

        <TextField
          label="Celular ou e-mail"
          value={identifier}
          onChange={value => { setIdentifier(value); setError(''); }}
          placeholder="(19) 99999-9999 ou nome@email.com"
          autoComplete="username"
          error={error || undefined}
        />

        <div className="flex flex-col gap-3 mt-auto">
          <LoadingButton loading={loading === 'continue'} disabled={!identifier.trim()} onClick={handleContinue}>Continuar</LoadingButton>
          <div className="flex items-center gap-3">
            <div className="flex-1 h-px bg-border" />
            <span className="text-xs text-muted-foreground">ou</span>
            <div className="flex-1 h-px bg-border" />
          </div>
          <SocialButton provider="google" loading={false} onClick={() => handleProvider('google')} />
          <SocialButton provider="apple" loading={false} onClick={() => handleProvider('apple')} />
          <p className="text-center text-sm text-muted-foreground">
            Não tem uma conta?{' '}
            <button onClick={() => go('signup-name')} className="text-foreground font-semibold underline underline-offset-2">Criar conta</button>
          </p>
        </div>
      </div>
    </div>
  );
}

/**
 * Atalho opcional (ficha 59, Sprint 2): aparece se a biometria foi ativada neste aparelho.
 * Abrir sessão por biometria exige WebAuthn no servidor, que ainda não existe.
 */
function BiometricLoginButton({ loading, onStart, onFinish }: { loading: boolean; onStart: () => void; onFinish: () => void }) {
  const { biometricUserId } = useDevice();
  const [available, setAvailable] = useState(false);

  useEffect(() => {
    let active = true;
    isBiometricAvailable().then(result => active && setAvailable(result));
    return () => { active = false; };
  }, []);

  if (!available || !biometricUserId) return null;

  async function authenticate() {
    onStart();
    await requestBiometricAuth();
    onFinish();
  }

  return (
    <button
      onClick={() => void authenticate()}
      disabled={loading}
      className="w-full flex items-center gap-4 bg-card border border-primary/30 rounded-xl px-4 py-4 text-left disabled:opacity-60"
    >
      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
        <Fingerprint size={20} className={loading ? 'text-primary animate-pulse' : 'text-primary'} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-display font-semibold text-foreground text-sm">{loading ? 'Aguardando biometria…' : 'Entrar com biometria'}</p>
        <p className="text-xs text-muted-foreground mt-0.5 truncate">Atalho deste aparelho</p>
      </div>
    </button>
  );
}

export function VerifyCodeScreen() {
  const { go, verification, account, finishAuth, showToast } = useClient();
  const [challengeId, setChallengeId] = useState(verification?.login?.challenge.challengeId ?? '');
  if (!verification) return null;
  const { purpose, channel, destination, returnTo, login } = verification;
  const channelLabel = channel === 'email' ? 'e-mail' : 'celular';

  /** Login por código: o servidor confere, consome o código e abre a sessão. */
  async function verifyLogin(code: string): Promise<CodeCheck> {
    try {
      await verifyLoginCode(challengeId, code);
      return 'ok';
    } catch (error) {
      if (isApiError(error, 'OTP_TOO_MANY_ATTEMPTS')) return 'too-many';
      if (isApiError(error, 'OTP_INVALID')) return 'invalid';
      throw error;
    }
  }

  async function resendLogin() {
    if (!login) return;
    try {
      setChallengeId((await requestLoginCode(channel, login.rawDestination)).challengeId);
    } catch (error) {
      throw new Error(errorMessage(error), { cause: error });
    }
  }

  function handleVerified() {
    if (purpose === 'login') {
      finishAuth();
      return;
    }
    // Confirmação de contato (ficha 65) ainda é simulada no navegador.
    if (account) markContactVerified(account, channel);
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
        {purpose === 'login' ? (
          <CodeVerification
            destination={destination}
            onVerified={handleVerified}
            onChangeDestination={() => go('login')}
            verify={verifyLogin}
            resend={resendLogin}
            devHint="o código aparece no terminal da API (provider de SMS/e-mail de desenvolvimento)."
          />
        ) : (
          <CodeVerification destination={destination} onVerified={handleVerified} />
        )}
        {purpose !== 'login' && (
          <button onClick={() => go(returnTo)} className="text-muted-foreground text-sm mt-2 self-start">
            Fazer isso depois
          </button>
        )}
      </div>
    </div>
  );
}
