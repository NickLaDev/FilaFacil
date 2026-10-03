import { useState } from 'react';
import { Check, Mail, Smartphone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatPhone, isStrongPassword, isValidEmail, isValidPhone } from '@/lib/validation';
import { RECOVERY_CODE_TTL_MS, requestPasswordRecovery, resetPassword } from '@/services/authService';
import { useClient } from '../clientContext';
import { BackButton, ResultScreen } from '../components/Layout';
import { LoadingButton, PasswordField, PasswordRequirements, TextField } from '../components/AuthFields';
import CodeVerification from '../components/CodeVerification';

type Step = 'request' | 'code' | 'new-password' | 'success' | 'no-account';
type Channel = 'email' | 'sms';

/** Recuperação por e-mail ou SMS com código que expira (ficha 44). */
export default function ForgotPasswordScreen() {
  const { go } = useClient();
  const [step, setStep] = useState<Step>('request');
  const [channel, setChannel] = useState<Channel>('email');
  const [destination, setDestination] = useState('');
  const [sentAt, setSentAt] = useState(0);
  const [expired, setExpired] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  const validDestination = channel === 'email' ? isValidEmail(destination) : isValidPhone(destination);

  async function sendCode() {
    setLoading(true);
    const found = await requestPasswordRecovery(channel, destination);
    setLoading(false);
    if (!found) return setStep('no-account');
    setSentAt(Date.now());
    setExpired(false);
    setStep('code');
  }

  function handleCodeVerified() {
    if (Date.now() - sentAt > RECOVERY_CODE_TTL_MS) {
      setExpired(true);
      setStep('request');
      return;
    }
    setStep('new-password');
  }

  async function savePassword() {
    setLoading(true);
    await resetPassword();
    setLoading(false);
    setStep('success');
  }

  if (step === 'no-account') {
    return (
      <ResultScreen
        icon={<div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center"><Mail size={24} className="text-muted-foreground" /></div>}
        title="Conta não encontrada"
        description={<>Não existe uma conta com <strong>{destination}</strong></>}
      >
        <button onClick={() => go('signup-name')} className="w-full bg-primary text-primary-foreground font-display font-semibold py-4 rounded-xl">Criar nova conta</button>
        <button onClick={() => setStep('request')} className="text-muted-foreground text-sm">Tentar outro {channel === 'email' ? 'e-mail' : 'celular'}</button>
      </ResultScreen>
    );
  }

  if (step === 'success') {
    return (
      <ResultScreen
        icon={<div className="w-16 h-16 rounded-2xl bg-success-bg flex items-center justify-center"><Check size={28} className="text-success" /></div>}
        title="Senha alterada"
        description="Agora você já pode entrar com a nova senha."
      >
        <button onClick={() => go('login')} className="w-full bg-primary text-primary-foreground font-display font-semibold py-4 rounded-xl">Entrar</button>
      </ResultScreen>
    );
  }

  const back = { request: () => go('login'), code: () => setStep('request'), 'new-password': () => setStep('code') }[step];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="px-5 pt-5">
        <BackButton onClick={back} />
      </div>
      <div className="flex-1 flex flex-col px-6 py-6 gap-6">
        {step === 'request' && (
          <>
            <div>
              <h1 className="font-display font-bold text-foreground text-2xl">Esqueci minha senha</h1>
              <p className="text-muted-foreground text-sm mt-1">Enviaremos um código para você criar uma nova senha.</p>
            </div>
            {expired && <p className="text-error text-sm bg-error-bg rounded-xl px-4 py-3">O código expirou. Solicite um novo.</p>}
            <div className="flex gap-2">
              {(['email', 'sms'] as const).map(option => (
                <button
                  key={option}
                  onClick={() => { setChannel(option); setDestination(''); }}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-medium transition-colors',
                    channel === option ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground',
                  )}
                >
                  {option === 'email' ? <Mail size={15} /> : <Smartphone size={15} />}
                  {option === 'email' ? 'E-mail' : 'SMS'}
                </button>
              ))}
            </div>
            {channel === 'email' ? (
              <TextField label="E-mail da conta" value={destination} onChange={setDestination} type="email" autoComplete="email" />
            ) : (
              <TextField label="Celular da conta" value={destination} onChange={value => setDestination(formatPhone(value))} type="tel" inputMode="tel" placeholder="(19) 99999-9999" />
            )}
            <div className="mt-auto">
              <LoadingButton loading={loading} disabled={!validDestination} onClick={sendCode}>Enviar código</LoadingButton>
            </div>
          </>
        )}

        {step === 'code' && (
          <>
            <h1 className="font-display font-bold text-foreground text-2xl">Verifique seu {channel === 'email' ? 'e-mail' : 'celular'}</h1>
            <CodeVerification destination={destination} onVerified={handleCodeVerified} />
            <p className="text-xs text-muted-foreground">O código vale por {RECOVERY_CODE_TTL_MS / 60000} minutos.</p>
          </>
        )}

        {step === 'new-password' && (
          <>
            <div>
              <h1 className="font-display font-bold text-foreground text-2xl">Nova senha</h1>
              <p className="text-muted-foreground text-sm mt-1">Crie uma senha segura para a sua conta</p>
            </div>
            <PasswordField label="Nova senha" value={password} onChange={setPassword} autoComplete="new-password" />
            <PasswordField
              label="Confirmar senha"
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
              error={confirm && confirm !== password ? 'As senhas não coincidem.' : undefined}
            />
            <PasswordRequirements password={password} />
            <div className="mt-auto">
              <LoadingButton loading={loading} disabled={!isStrongPassword(password) || password !== confirm} onClick={savePassword}>
                Salvar senha
              </LoadingButton>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
