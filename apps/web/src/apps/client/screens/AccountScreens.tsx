import { useEffect, useState } from 'react';
import { Check, ChevronRight, Fingerprint, Loader2, Trash2 } from 'lucide-react';
import Toggle from '@/components/ui/Toggle';
import { requestAccountDeletion, setBiometricEnabled, useDevice } from '@/services/accountExtrasService';
import { isBiometricAvailable, requestBiometricAuth } from '@/services/deviceService';
import { useClient } from '../clientContext';
import { BackButton, ResultScreen, ScreenHeader } from '../components/Layout';
import { TermsCheckbox } from '../components/AuthFields';
import CodeVerification from '../components/CodeVerification';

/** Biometria como atalho opcional — o login tradicional continua disponível (ficha 59). */
export function AccountSecurityScreen() {
  const { go, account, showToast } = useClient();
  const { biometricUserId } = useDevice();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    let active = true;
    isBiometricAvailable().then(result => active && setAvailable(result));
    return () => { active = false; };
  }, []);

  if (!account) return null;
  const enabled = biometricUserId === account.id;

  async function toggleBiometrics(next: boolean) {
    if (!account) return;
    if (!next) {
      setBiometricEnabled(account.id, false);
      showToast('Login por biometria desativado');
      return;
    }
    setConfirming(true);
    const ok = await requestBiometricAuth();
    setConfirming(false);
    if (!ok) return showToast('Não foi possível confirmar a biometria');
    setBiometricEnabled(account.id, true);
    showToast('Login por biometria ativado');
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
          <Toggle label="Entrar com biometria" checked={enabled} onChange={toggleBiometrics} disabled={!available || confirming} />
        </div>

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

/** Exclusão de conta com autenticação adicional (ficha 53 · LGPD — Sprint 2, processamento ainda simulado). */
export function DeleteAccountScreen() {
  const { go, account } = useClient();
  const [step, setStep] = useState<DeleteStep>('info');
  const [understood, setUnderstood] = useState(false);
  const [confirmationTarget] = useState(() => account?.email || account?.phone || '');

  async function confirmDeletion() {
    if (!account) return;
    setStep('deleting');
    await requestAccountDeletion();
    setStep('done');
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
                onClick={() => setStep('auth')}
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
            <CodeVerification destination={confirmationTarget} onVerified={confirmDeletion} />
          </div>
        </>
      )}
    </div>
  );
}
