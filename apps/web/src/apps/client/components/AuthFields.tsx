import { useId, useState, type ReactNode } from 'react';
import { Check, Eye, EyeOff, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PASSWORD_RULES } from '@/lib/validation';

interface TextFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
  placeholder?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
  inputMode?: 'text' | 'numeric' | 'tel' | 'email';
  autoComplete?: string;
}

export function TextField({ label, value, onChange, type = 'text', placeholder, error, hint, disabled, inputMode, autoComplete }: TextFieldProps) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-foreground mb-1.5">{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        disabled={disabled}
        inputMode={inputMode}
        autoComplete={autoComplete}
        aria-invalid={Boolean(error)}
        className={cn(
          'w-full bg-card border rounded-xl px-4 py-3.5 text-sm text-foreground placeholder-muted-foreground focus:outline-none focus:border-primary transition-colors disabled:opacity-50',
          error ? 'border-error' : 'border-border',
        )}
      />
      {error ? <p className="text-error text-xs mt-1.5">{error}</p> : hint && <p className="text-xs text-muted-foreground mt-1.5">{hint}</p>}
    </div>
  );
}

interface PasswordFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  error?: string;
  autoComplete?: string;
}

export function PasswordField({ label, value, onChange, error, autoComplete = 'current-password' }: PasswordFieldProps) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  return (
    <div>
      <label htmlFor={id} className="block text-sm font-medium text-foreground mb-1.5">{label}</label>
      <div className="relative">
        <input
          id={id}
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={event => onChange(event.target.value)}
          autoComplete={autoComplete}
          aria-invalid={Boolean(error)}
          className={cn(
            'w-full bg-card border rounded-xl px-4 py-3.5 pr-12 text-sm text-foreground focus:outline-none focus:border-primary transition-colors',
            error ? 'border-error' : 'border-border',
          )}
        />
        <button
          type="button"
          onClick={() => setVisible(v => !v)}
          className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          aria-label={visible ? 'Ocultar senha' : 'Mostrar senha'}
        >
          {visible ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
      {error && <p className="text-error text-xs mt-1.5">{error}</p>}
    </div>
  );
}

export function PasswordRequirements({ password }: { password: string }) {
  return (
    <div className="flex flex-col gap-1.5">
      {PASSWORD_RULES.map(rule => {
        const ok = rule.test(password);
        return (
          <div key={rule.label} className="flex items-center gap-2">
            <div className={cn('w-4 h-4 rounded-full flex items-center justify-center flex-shrink-0 transition-colors', ok ? 'bg-success' : 'bg-muted border border-border')}>
              {ok && <Check size={10} className="text-white" />}
            </div>
            <span className={cn('text-xs transition-colors', ok ? 'text-success' : 'text-muted-foreground')}>{rule.label}</span>
          </div>
        );
      })}
    </div>
  );
}

interface LoadingButtonProps {
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  children: ReactNode;
}

export function LoadingButton({ loading, disabled, onClick, children }: LoadingButtonProps) {
  const inactive = disabled || loading;
  return (
    <button
      onClick={onClick}
      disabled={inactive}
      className={cn(
        'w-full font-display font-semibold py-4 rounded-xl text-base flex items-center justify-center gap-2 transition-all',
        inactive ? 'bg-muted text-muted-foreground cursor-not-allowed' : 'bg-primary text-primary-foreground active:scale-98',
      )}
    >
      {loading && <Loader2 size={17} className="animate-spin" />}
      {children}
    </button>
  );
}

export function SocialButton({ provider, loading, onClick }: { provider: 'google' | 'apple'; loading?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      disabled={loading}
      className="w-full flex items-center justify-center gap-3 border border-border bg-card rounded-xl py-3.5 text-sm font-medium text-foreground hover:bg-muted transition-colors disabled:opacity-60"
    >
      {loading ? <Loader2 size={16} className="animate-spin" /> : <span className="text-lg" aria-hidden="true">{provider === 'google' ? '🟦' : '⬛'}</span>}
      Continuar com {provider === 'google' ? 'Google' : 'Apple'}
    </button>
  );
}

export function TermsCheckbox({ checked, onChange, label, required }: { checked: boolean; onChange: (value: boolean) => void; label: ReactNode; required?: boolean }) {
  return (
    <label className="flex items-start gap-3 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} className="sr-only peer" />
      <span
        className={cn(
          'w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-primary',
          checked ? 'bg-primary border-primary' : 'border-border',
        )}
      >
        {checked && <Check size={12} className="text-white" />}
      </span>
      <span className="text-sm text-foreground leading-relaxed">
        {label}
        {required && <span className="text-error ml-1">*</span>}
      </span>
    </label>
  );
}
