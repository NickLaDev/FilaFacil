import { useState } from 'react';
import { Check, Mail, ShieldAlert, Smartphone } from 'lucide-react';
import { errorMessage, isApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { formatCpf, formatPhone, isStrongPassword, isValidCpf, isValidEmail, isValidPhone } from '@/lib/validation';
import { registerAccount } from '@/services/authService';
import { isAccountVerified, useClient } from '../clientContext';
import { BackButton } from '../components/Layout';
import { LoadingButton, PasswordField, PasswordRequirements, TermsCheckbox, TextField } from '../components/AuthFields';

/**
 * Passo 1: nome + CPF com dígitos verificadores válidos (ficha 01). A duplicidade é conferida
 * pelo servidor no envio do cadastro — não existe consulta "este CPF tem conta?" aberta.
 */
export function SignupNameScreen() {
  const { go, signupDraft, setSignupDraft } = useClient();
  const [firstName, ...rest] = signupDraft.name.split(' ');
  const [first, setFirst] = useState(firstName ?? '');
  const [last, setLast] = useState(rest.join(' '));
  const [cpf, setCpf] = useState(signupDraft.cpf);
  const [cpfError, setCpfError] = useState(signupDraft.serverError?.field === 'cpf' ? signupDraft.serverError.message : '');

  function handleContinue() {
    if (!isValidCpf(cpf)) return setCpfError('CPF inválido. Confira os números digitados.');
    setSignupDraft({ ...signupDraft, name: `${first.trim()} ${last.trim()}`, cpf, serverError: undefined });
    go('signup-contact');
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="px-5 pt-5">
        <BackButton onClick={() => go('welcome')} />
      </div>
      <div className="flex-1 flex flex-col px-6 py-6 gap-6">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-1">Passo 1 de 2</p>
          <h1 className="font-display font-bold text-foreground text-2xl">Vamos criar sua conta</h1>
        </div>
        <div className="flex flex-col gap-4">
          <TextField label="Nome" value={first} onChange={setFirst} placeholder="Ex: Lucas" autoComplete="given-name" />
          <TextField label="Sobrenome" value={last} onChange={setLast} placeholder="Ex: Torres" autoComplete="family-name" />
          <TextField
            label="CPF"
            value={cpf}
            onChange={value => { setCpf(formatCpf(value)); setCpfError(''); }}
            placeholder="000.000.000-00"
            inputMode="numeric"
            error={cpfError || undefined}
            hint="Usamos o CPF para identificar seus pedidos e emitir comprovantes."
          />
          {cpfError.includes('cadastro') && (
            <button onClick={() => go('login')} className="text-primary text-sm font-medium text-left -mt-2">Ir para o login</button>
          )}
        </div>
        <div className="mt-auto">
          <LoadingButton disabled={!first.trim() || !last.trim() || cpf.length < 14} onClick={handleContinue}>
            Continuar
          </LoadingButton>
        </div>
      </div>
    </div>
  );
}

export function SignupContactScreen() {
  const { go, signupDraft, setSignupDraft } = useClient();
  const [method, setMethod] = useState<'phone' | 'email'>(signupDraft.email ? 'email' : 'phone');
  const [phone, setPhone] = useState(signupDraft.phone);
  const [email, setEmail] = useState(signupDraft.email);
  const [password, setPassword] = useState(signupDraft.password);
  const [confirm, setConfirm] = useState(signupDraft.password);
  const [error, setError] = useState(signupDraft.serverError?.field === 'contact' ? signupDraft.serverError.message : '');

  const canContinue = method === 'phone'
    ? isValidPhone(phone)
    : isValidEmail(email) && isStrongPassword(password) && password === confirm;

  function handleContinue() {
    // A senha fica só em memória até o envio do cadastro (nunca no armazenamento do navegador).
    setSignupDraft({
      ...signupDraft,
      phone: method === 'phone' ? phone : '',
      email: method === 'email' ? email.trim() : '',
      password: method === 'email' ? password : '',
      serverError: undefined,
    });
    go('signup-terms');
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="px-5 pt-5">
        <BackButton onClick={() => go('signup-name')} />
      </div>
      <div className="flex-1 flex flex-col px-6 py-6 gap-6">
        <div>
          <p className="text-xs text-muted-foreground uppercase tracking-wider font-medium mb-1">Passo 2 de 2</p>
          <h1 className="font-display font-bold text-foreground text-2xl">Como quer acessar?</h1>
        </div>
        <div className="flex gap-2">
          {(['phone', 'email'] as const).map(option => (
            <button
              key={option}
              onClick={() => { setMethod(option); setError(''); }}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 py-3 rounded-xl border text-sm font-medium transition-colors',
                method === option ? 'border-primary bg-primary/5 text-primary' : 'border-border text-muted-foreground',
              )}
            >
              {option === 'phone' ? <Smartphone size={15} /> : <Mail size={15} />}
              {option === 'phone' ? 'Celular' : 'E-mail'}
            </button>
          ))}
        </div>

        {method === 'phone' ? (
          <TextField
            label="Celular"
            value={phone}
            onChange={value => { setPhone(formatPhone(value)); setError(''); }}
            placeholder="(19) 99999-9999"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            error={error || undefined}
          />
        ) : (
          <div className="flex flex-col gap-4">
            <TextField label="E-mail" value={email} onChange={value => { setEmail(value); setError(''); }} type="email" autoComplete="email" error={error || undefined} />
            <PasswordField label="Senha" value={password} onChange={setPassword} autoComplete="new-password" />
            <PasswordField
              label="Confirmar senha"
              value={confirm}
              onChange={setConfirm}
              autoComplete="new-password"
              error={confirm && confirm !== password ? 'As senhas não coincidem.' : undefined}
            />
            <PasswordRequirements password={password} />
          </div>
        )}

        <div className="mt-auto">
          <LoadingButton disabled={!canContinue} onClick={handleContinue}>Continuar</LoadingButton>
        </div>
      </div>
    </div>
  );
}

export function SignupTermsScreen() {
  const { go, signupDraft, setSignupDraft, requestVerification } = useClient();
  const [terms, setTerms] = useState(false);
  const [promo, setPromo] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function createAccount() {
    setLoading(true);
    setError('');
    try {
      await registerAccount({
        name: signupDraft.name,
        cpf: signupDraft.cpf,
        ...(signupDraft.email ? { email: signupDraft.email, password: signupDraft.password } : { phone: signupDraft.phone }),
        marketingOptIn: promo,
      });
    } catch (failure) {
      setLoading(false);
      // CPF ou contato já cadastrado: volta ao passo certo com a mensagem do servidor.
      if (isApiError(failure, 'CPF_ALREADY_REGISTERED') || isApiError(failure, 'INVALID_CPF')) {
        setSignupDraft({ ...signupDraft, password: '', serverError: { field: 'cpf', message: failure.message } });
        return go('signup-name');
      }
      if (isApiError(failure, 'EMAIL_IN_USE') || isApiError(failure, 'PHONE_IN_USE')) {
        setSignupDraft({ ...signupDraft, password: '', serverError: { field: 'contact', message: failure.message } });
        return go('signup-contact');
      }
      return setError(errorMessage(failure));
    }
    setLoading(false);
    const channel = signupDraft.email ? 'email' : 'phone';
    requestVerification({ purpose: 'signup', channel, destination: signupDraft.email || formatPhone(signupDraft.phone), returnTo: 'account-created' });
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="px-5 pt-5">
        <BackButton onClick={() => go('signup-contact')} />
      </div>
      <div className="flex-1 flex flex-col px-6 py-6 gap-6">
        <div>
          <h1 className="font-display font-bold text-foreground text-2xl">Quase lá</h1>
          <p className="text-muted-foreground text-sm mt-1">Antes de criar sua conta, confirme os termos</p>
        </div>
        <div className="flex flex-col gap-4">
          <TermsCheckbox
            checked={terms}
            onChange={setTerms}
            required
            label={<>Li e aceito os <span className="text-primary font-medium">Termos de Uso</span> e a <span className="text-primary font-medium">Política de Privacidade</span>.</>}
          />
          <TermsCheckbox checked={promo} onChange={setPromo} label="Quero receber promoções e novidades." />
        </div>
        {error && <p className="text-error text-sm">{error}</p>}
        <div className="mt-auto">
          <LoadingButton loading={loading} disabled={!terms} onClick={() => void createAccount()}>Criar minha conta</LoadingButton>
        </div>
      </div>
    </div>
  );
}

export function AccountCreatedScreen() {
  const { account, finishAuth } = useClient();
  const verified = account ? isAccountVerified(account) : false;
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-5 px-8">
      <div className="w-20 h-20 rounded-2xl bg-success-bg flex items-center justify-center">
        <Check size={36} className="text-success" />
      </div>
      <div className="text-center">
        <p className="font-display font-bold text-foreground text-2xl">Conta criada!</p>
        <p className="text-muted-foreground text-sm mt-1">Agora ficou mais rápido pedir nas próximas vezes.</p>
      </div>
      {!verified && (
        <div className="w-full bg-warning-bg border border-warning/20 rounded-xl px-4 py-3 flex items-start gap-2">
          <ShieldAlert size={15} className="text-warning flex-shrink-0 mt-0.5" />
          <p className="text-sm text-warning">Confirme seu e-mail ou celular no perfil para poder pagar pelo app.</p>
        </div>
      )}
      <button onClick={finishAuth} className="w-full bg-primary text-primary-foreground font-display font-semibold py-4 rounded-xl">Continuar</button>
    </div>
  );
}
