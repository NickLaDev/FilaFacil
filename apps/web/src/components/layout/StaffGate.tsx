import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { ROLE_LABELS, type MeResponse, type UserRole } from '@filafacil/shared';
import { BrandMark } from '@/components/brand/Logo';
import FormField, { PANEL_INPUT_CLASS } from '@/components/ui/FormField';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { BRAND } from '@/config/brand';
import { errorMessage, onSessionEvent } from '@/lib/api/client';
import { handleSessionExpired, loginWithEmail, logout, useMe } from '@/services/authService';
import AccessBlocked from './AccessBlocked';

interface StaffGateProps {
  panelLabel: string;
  allowedRoles: UserRole[];
  children: (me: MeResponse) => ReactNode;
}

/**
 * Entrada dos painéis da equipe: exige login, confere o papel e reage na hora a suspensão
 * ou revogação da sessão. A autorização de cada ação continua sendo feita pela API.
 */
export default function StaffGate({ panelLabel, allowedRoles, children }: StaffGateProps) {
  const me = useMe();
  const [suspended, setSuspended] = useState(false);

  useEffect(
    () =>
      onSessionEvent(event => {
        if (event === 'suspended') setSuspended(true);
        else handleSessionExpired();
      }),
    [],
  );

  async function signOut() {
    setSuspended(false);
    await logout();
  }

  if (suspended) return <AccessBlocked action={{ label: 'Sair', onClick: () => void signOut() }} />;
  if (me.isPending) return <LoadingBlock className="min-h-screen bg-background" />;
  if (me.error) return <ErrorBlock error={me.error} onRetry={() => void me.refetch()} className="min-h-screen bg-background" />;
  if (!me.data) return <StaffLogin panelLabel={panelLabel} />;
  if (!allowedRoles.includes(me.data.user.role)) {
    return (
      <AccessBlocked
        title="Acesso exclusivo"
        description={`Este painel é para ${allowedRoles.map(role => ROLE_LABELS[role].toLowerCase()).join(' ou ')}. Sua conta é de ${ROLE_LABELS[me.data.user.role].toLowerCase()}.`}
        action={{ label: 'Entrar com outra conta', onClick: () => void signOut() }}
      />
    );
  }
  return <>{children(me.data)}</>;
}

function StaffLogin({ panelLabel }: { panelLabel: string }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      await loginWithEmail(email, password);
    } catch (failure) {
      setError(errorMessage(failure));
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <form onSubmit={handleSubmit} className="bg-card border border-border rounded-2xl p-8 w-full max-w-sm flex flex-col gap-5" noValidate>
        <div className="flex items-center gap-3">
          <div className="w-11 h-11 rounded-xl bg-[#18160F] flex items-center justify-center">
            <BrandMark size={24} color="#E8700A" />
          </div>
          <div>
            <p className="font-display font-bold text-foreground leading-none">{BRAND.name}</p>
            <p className="text-xs text-muted-foreground mt-1">{panelLabel}</p>
          </div>
        </div>
        <div>
          <h1 className="font-display font-bold text-foreground text-xl">Entrar</h1>
          <p className="text-sm text-muted-foreground mt-1">Use o e-mail e a senha da sua conta da equipe.</p>
        </div>
        <FormField label="E-mail" htmlFor="staff-email">
          <input id="staff-email" type="email" autoComplete="username" value={email} onChange={e => setEmail(e.target.value)} className={PANEL_INPUT_CLASS} required />
        </FormField>
        <FormField label="Senha" htmlFor="staff-password" error={error || undefined}>
          <input id="staff-password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} className={PANEL_INPUT_CLASS} required />
        </FormField>
        <button
          type="submit"
          disabled={loading || !email.trim() || !password}
          className="w-full bg-primary text-primary-foreground font-display font-semibold py-3 rounded-xl flex items-center justify-center gap-2 disabled:opacity-60"
        >
          {loading && <Loader2 size={16} className="animate-spin" />}
          Entrar
        </button>
        {import.meta.env.DEV && (
          <p className="text-[11px] text-muted-foreground bg-muted rounded-lg px-3 py-2 leading-relaxed">
            <strong className="text-foreground">Dev:</strong> contas do seed no README (senha <code>FilaFacil123</code>).
          </p>
        )}
      </form>
    </div>
  );
}
