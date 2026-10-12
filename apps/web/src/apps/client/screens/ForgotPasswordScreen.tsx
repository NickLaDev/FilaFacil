import { useState } from 'react';
import { Check, Mail, Smartphone } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatPhone, isStrongPassword, isValidEmail, isValidPhone } from '@/lib/validation';
import { errorMessage, isApiError } from '@/lib/api/client';
import { requestPasswordReset, resetPassword } from '@/services/authService';
import { useClient } from '../clientContext';
import { BackButton, ResultScreen } from '../components/Layout';
import { LoadingButton, PasswordField, PasswordRequirements, TextField } from '../components/AuthFields';
import CodeVerification from '../components/CodeVerification';

type Step = 'request' | 'code' | 'new-password' | 'success';

/** Validade do código de recuperação (definida pelo servidor). */
const RECOVERY_CODE_MINUTES = 10;
type Channel = 'email' | 'sms';

/** Recuperação por e-mail ou SMS com código que expira (ficha 44). */
export default function ForgotPasswordScreen() {
  const { go } = useClient();
  const [step, setStep] = useState<Step>('request');
  const [channel, setChannel] = useState<Channel>('email');
  const [destination, setDestination] = useState('');
  // Mais novo primeiro. Um reenvio dentro do intervalo pode devolver um desafio sem código; manter os anteriores evita perder o código certo.
  const [challengeIds, setChallengeIds] = useState<string[]>([]);
  const [code, setCode] = useState('');
  const [notice, setNotice] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);

  const validDestination = channel === 'email' ? isValidEmail(destination) : isValidPhone(destination);

  const otpChannel = channel === 'email' ? 'email' : 'phone';

  async function sendCode() {
    setLoading(true);
    setNotice('');
    try {
      setChallengeIds([(await requestPasswordReset(otpChannel, destination)).challengeId]);
      setStep('code');
    } catch (error) {
      setNotice(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }

  async function resend() {
    try {
      const next = (await requestPasswordReset(otpChannel, destination)).challengeId;
      setChallengeIds(prev => [next, ...prev.filter(id => id !== next)].slice(0, 3));
    } catch (error) {
      throw new Error(errorMessage(error), { cause: error });
    }
  }

  async function savePassword() {
    setLoading(true);
    setNotice('');
    try {
      let lastError: unknown;
      for (const id of challengeIds) {
        try {
          await resetPassword(id, code, password);
          setStep('success');
          return;
        } catch (error) {
          lastError = error;
          // Só tenta o desafio anterior quando este não reconhece o código.
          if (!isApiError(error, 'OTP_INVALID')) break;
        }
      }
      throw lastError;
    } catch (error) {
      // Código errado, expirado ou esgotado: volta para pedir um novo.
      if (isApiError(error) && error.code.startsWith('OTP_')) {
        setNotice(error.code === 'OTP_TOO_MANY_ATTEMPTS' ? 'Muitas tentativas. Solicite um novo código.' : 'Código incorreto ou expirado. Digite novamente ou solicite um novo.');
        setStep(error.code === 'OTP_INVALID' ? 'code' : 'request');
      } else {
        setNotice(errorMessage(error));
      }
    } finally {
      setLoading(false);
    }
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
            {notice && <p className="text-error text-sm bg-error-bg rounded-xl px-4 py-3">{notice}</p>}
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
            {notice && <p className="text-error text-sm bg-error-bg rounded-xl px-4 py-3">{notice}</p>}
            <CodeVerification
              destination={destination}
              // O servidor confere o código junto com a nova senha; aqui só guardamos os 6 dígitos.
              verify={async value => { setCode(value); return 'ok'; }}
              onVerified={() => setStep('new-password')}
              resend={resend}
              devHint="o código aparece no terminal da API."
            />
            <p className="text-xs text-muted-foreground">O código vale por {RECOVERY_CODE_MINUTES} minutos.</p>
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
            {notice && <p className="text-error text-sm">{notice}</p>}
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
