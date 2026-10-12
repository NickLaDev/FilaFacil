import { useEffect, useState } from 'react';
import { Check, ChevronRight, Fingerprint, Loader2, Trash2 } from 'lucide-react';
import Toggle from '@/components/ui/Toggle';
import { errorMessage, isApiError } from '@/lib/api/client';
import { deleteAccount, isBiometricCancelled, registerBiometric, removeBiometric, requestAccountDeletionCode, requestBiometricCode, useWebAuthnCredentials } from '@/services/authService';
import { isBiometricAvailable, setBiometricHint, useBiometricCredentialId } from '@/services/deviceService';
import { useClient } from '../clientContext';
import { BackButton, ResultScreen, ScreenHeader } from '../components/Layout';
import { PasswordField, TermsCheckbox } from '../components/AuthFields';
import CodeVerification, { type CodeCheck } from '../components/CodeVerification';

/** Biometria como atalho opcional — o login tradicional continua disponível (ficha 59). */
export function AccountSecurityScreen() {
  const { go, account, showToast } = useClient();
  const credentials = useWebAuthnCredentials(Boolean(account));
  const deviceCredentialId = useBiometricCredentialId();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [askingPassword, setAskingPassword] = useState(false);
  const [biometricPassword, setBiometricPassword] = useState('');
  const [biometricError, setBiometricError] = useState('');
  const [codeChallenge, setCodeChallenge] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    isBiometricAvailable().then(result => active && setAvailable(result));
    return () => { active = false; };
  }, []);

  if (!account) return null;
  // Por aparelho: só vale a credencial cadastrada aqui (outras contas/aparelhos não ligam o botão).
  const enabled = Boolean(deviceCredentialId && credentials.data?.some(credential => credential.id === deviceCredentialId));

  function requestToggle(next: boolean) {
    setBiometricError('');
    if (next && account?.hasPassword) setAskingPassword(true);
    else if (next) void startCodeConfirmation();
    else void toggleBiometrics(next);
  }

  // Conta sem senha: o código vai para o contato já verificado e faz o papel da senha.
  const codeChannel = account?.email && account.emailVerified ? 'email' : account?.phone && account.phoneVerified ? 'phone' : null;
  const codeTarget = codeChannel === 'email' ? account?.email : account?.phone;

  async function startCodeConfirmation() {
    if (!codeChannel) {
      showToast('Verifique seu e-mail ou celular antes de ativar a biometria.');
      return;
    }
    setConfirming(true);
    try {
      setCodeChallenge((await requestBiometricCode(codeChannel)).challengeId);
    } catch (error) {
      showToast(errorMessage(error, 'Não foi possível enviar o código'));
    } finally {
      setConfirming(false);
    }
  }

  async function verifyCode(code: string): Promise<CodeCheck> {
    try {
      const credential = await registerBiometric({ challengeId: codeChallenge ?? '', code });
      setBiometricHint(credential.id);
      showToast('Login por biometria ativado');
      return 'ok';
    } catch (error) {
      if (isApiError(error, 'OTP_TOO_MANY_ATTEMPTS')) return 'too-many';
      if (isApiError(error, 'OTP_INVALID')) return 'invalid';
      // O código já foi usado: cancelar a biometria do aparelho exige pedir um novo.
      setCodeChallenge(null);
      if (!isBiometricCancelled(error)) showToast(errorMessage(error, 'Não foi possível ativar a biometria'));
      return 'ok';
    }
  }

  async function toggleBiometrics(next: boolean, confirmPassword?: string) {
    setConfirming(true);
    try {
      if (!next) {
        if (deviceCredentialId) await removeBiometric(deviceCredentialId);
        setBiometricHint(null);
        showToast('Login por biometria desativado');
      } else {
        const credential = await registerBiometric({ password: confirmPassword });
        setAskingPassword(false);
        setBiometricPassword('');
        setBiometricHint(credential.id);
        showToast('Login por biometria ativado');
      }
    } catch (error) {
      if (isBiometricCancelled(error)) return;
      const message = errorMessage(error, 'Não foi possível confirmar a biometria');
      if (askingPassword) setBiometricError(message);
      else showToast(message);
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col pb-24">
      <ScreenHeader title="Segurança e privacidade" onBack={() => go('profile')} />
      <div className="px-5 py-5 flex flex-col gap-3">
        <div className="bg-card border border-border rounded-xl px-5 py-4 flex items-center gap-4">
          <div className="w-9 h-9 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
            {confirming ? <Loader2 size={16} className="text-primary animate-spin" /> : <Fingerprint size={16} className="text-primary" />}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-foreground">Entrar com biometria</p>
            <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
              {available === false
                ? 'Este aparelho não oferece Face ID, Touch ID ou leitor de digital.'
                : 'Use Face ID ou digital neste aparelho. Celular/e-mail continuam valendo.'}
            </p>
          </div>
          <Toggle label="Entrar com biometria" checked={enabled} onChange={requestToggle} disabled={(!available && !enabled) || confirming || credentials.isLoading} />
        </div>

        {askingPassword && (
          <div className="bg-card border border-border rounded-xl px-5 py-4 flex flex-col gap-3">
            <p className="text-sm text-foreground">Confirme sua senha para ativar a biometria neste aparelho.</p>
            <PasswordField label="Sua senha" value={biometricPassword} onChange={setBiometricPassword} />
            {biometricError && <p className="text-error text-sm">{biometricError}</p>}
            <div className="flex gap-2">
              <button onClick={() => { setAskingPassword(false); setBiometricPassword(''); setBiometricError(''); }} className="flex-1 border border-border rounded-xl py-2.5 text-sm text-muted-foreground">Cancelar</button>
              <button
                onClick={() => void toggleBiometrics(true, biometricPassword)}
                disabled={!biometricPassword || confirming}
                className="flex-1 bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold disabled:opacity-50"
              >
                {confirming ? 'Aguardando…' : 'Ativar'}
              </button>
            </div>
          </div>
        )}

        {codeChallenge && (
          <div className="bg-card border border-border rounded-xl px-5 py-4 flex flex-col gap-3">
            <p className="text-sm text-foreground">Digite o código enviado para confirmar a ativação da biometria.</p>
            <CodeVerification
              destination={codeTarget ?? ''}
              verify={verifyCode}
              onVerified={() => setCodeChallenge(null)}
              resend={async () => {
                if (!codeChannel) return;
                try {
                  setCodeChallenge((await requestBiometricCode(codeChannel)).challengeId);
                } catch (error) {
                  throw new Error(errorMessage(error), { cause: error });
                }
              }}
              devHint="o código aparece no terminal da API."
            />
            <button onClick={() => setCodeChallenge(null)} className="text-muted-foreground text-sm self-start">Cancelar</button>
          </div>
        )}

        <button onClick={() => go('delete-account')} className="w-full flex items-center justify-between bg-error-bg border border-error/20 rounded-xl px-5 py-4 text-left mt-2">
          <span className="text-sm text-error font-medium">Excluir minha conta</span>
          <ChevronRight size={15} className="text-error" />
        </button>
        <p className="text-xs text-muted-foreground px-1 leading-relaxed">
          Você pode pedir a exclusão dos seus dados pessoais a qualquer momento, conforme a LGPD.
        </p>
      </div>
    </div>
  );
}

type DeleteStep = 'info' | 'auth' | 'deleting' | 'done';

/** Exclusão de conta com autenticação adicional (ficha 53 · LGPD). */
export function DeleteAccountScreen() {
  const { go, account } = useClient();
  const [step, setStep] = useState<DeleteStep>('info');
  const [understood, setUnderstood] = useState(false);
  const [challengeId, setChallengeId] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState('');
  const [confirmationTarget] = useState(() => account?.email || account?.phone || '');

  // O código só vai para um contato verificado.
  const channel = account?.email && account.emailVerified ? 'email' : 'phone';
  const [method, setMethod] = useState<'password' | 'code'>('password');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [authError, setAuthError] = useState('');

  async function switchToCodeMethod() {
    setSending(true);
    setSendError('');
    try {
      setChallengeId((await requestAccountDeletionCode(channel)).challengeId);
      setMethod('code');
    } catch (error) {
      setSendError(errorMessage(error));
    } finally {
      setSending(false);
    }
  }

  async function submitPassword() {
    setSubmitting(true);
    setAuthError('');
    try {
      await deleteAccount({ password });
      setStep('done');
    } catch (error) {
      setAuthError(isApiError(error, 'ACTIVE_ORDERS') ? 'Você tem pedidos em andamento. Aguarde a conclusão para excluir a conta.' : errorMessage(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function verify(code: string): Promise<CodeCheck> {
    try {
      await deleteAccount({ challengeId, code });
      return 'ok';
    } catch (error) {
      if (isApiError(error, 'OTP_TOO_MANY_ATTEMPTS')) return 'too-many';
      if (isApiError(error, 'OTP_INVALID')) return 'invalid';
      throw error;
    }
  }

  async function resend() {
    try {
      setChallengeId((await requestAccountDeletionCode(channel)).challengeId);
    } catch (error) {
      throw new Error(errorMessage(error), { cause: error });
    }
  }

  if (step === 'done') {
    return (
      <ResultScreen
        icon={<div className="w-16 h-16 rounded-2xl bg-success-bg flex items-center justify-center"><Check size={28} className="text-success" /></div>}
        title="Pedido de exclusão recebido"
        description={<>Sua sessão foi encerrada. Os dados pessoais serão removidos ou anonimizados em até 30 dias, com confirmação para <strong>{confirmationTarget}</strong>.</>}
      >
        <button onClick={() => go('welcome')} className="w-full bg-primary text-primary-foreground font-display font-semibold py-4 rounded-xl">Voltar ao início</button>
      </ResultScreen>
    );
  }

  if (step === 'deleting') {
    return (
      <ResultScreen
        icon={<div className="w-16 h-16 rounded-2xl bg-error-bg flex items-center justify-center"><Loader2 size={28} className="text-error animate-spin" /></div>}
        title="Excluindo sua conta"
      />
    );
  }

  if (!account) return null;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {step === 'info' ? (
        <>
          <ScreenHeader title="Excluir conta" onBack={() => go('account-security')} />
          <div className="flex-1 px-5 py-5 flex flex-col gap-5">
            <div className="w-14 h-14 rounded-2xl bg-error-bg flex items-center justify-center">
              <Trash2 size={24} className="text-error" />
            </div>
            <div>
              <h1 className="font-display font-bold text-foreground text-xl">Antes de excluir</h1>
              <ul className="text-sm text-muted-foreground mt-3 flex flex-col gap-2 list-disc pl-5 leading-relaxed">
                <li>Nome, CPF, contatos, endereços e favoritos serão removidos ou anonimizados em até 30 dias.</li>
                <li>Você perde o acesso ao histórico de pedidos e comprovantes.</li>
                <li>Enviaremos a confirmação da exclusão para {confirmationTarget}.</li>
                <li>Esta ação não pode ser desfeita.</li>
              </ul>
            </div>
            <TermsCheckbox checked={understood} onChange={setUnderstood} label="Entendo que a exclusão é definitiva." />
            <div className="mt-auto pb-6">
              <button
                onClick={() => {
                  setStep('auth');
                  // Conta sem senha (login social/celular): reautentica direto pelo código.
                  if (!account.hasPassword) void switchToCodeMethod();
                }}
                disabled={!understood}
                className="w-full bg-error text-white font-display font-semibold py-4 rounded-xl disabled:opacity-50"
              >
                Continuar
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="px-5 pt-5">
            <BackButton onClick={() => setStep('info')} />
          </div>
          <div className="flex-1 flex flex-col px-6 py-6 gap-4">
            <h1 className="font-display font-bold text-foreground text-2xl">Confirme que é você</h1>
            {method === 'password' && account.hasPassword ? (
              <>
                <PasswordField label="Sua senha" value={password} onChange={setPassword} />
                {(authError || sendError) && <p className="text-error text-sm">{authError || sendError}</p>}
                <button
                  onClick={() => void submitPassword()}
                  disabled={!password || submitting}
                  className="w-full bg-error text-white font-display font-semibold py-4 rounded-xl disabled:opacity-50"
                >
                  {submitting ? 'Excluindo…' : 'Excluir minha conta'}
                </button>
                <button onClick={() => void switchToCodeMethod()} disabled={sending} className="text-primary text-sm font-medium self-start disabled:opacity-60">
                  {sending ? 'Enviando código…' : 'Receber um código em vez da senha'}
                </button>
              </>
            ) : !challengeId ? (
              <div className="flex flex-col gap-3">
                <p className={sendError ? 'text-error text-sm' : 'text-sm text-muted-foreground'}>{sendError || 'Enviando o código…'}</p>
                {sendError && (
                  <button onClick={() => void switchToCodeMethod()} className="self-start text-primary text-sm font-medium">Tentar novamente</button>
                )}
              </div>
            ) : (
              <CodeVerification destination={confirmationTarget} verify={verify} resend={resend} onVerified={() => setStep('done')} devHint="o código aparece no terminal da API." />
            )}
          </div>
        </>
      )}
    </div>
  );
}
