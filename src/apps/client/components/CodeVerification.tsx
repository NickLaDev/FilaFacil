import { useRef, useState, type KeyboardEvent } from 'react';
import { Loader2 } from 'lucide-react';
import { cn, formatCountdown } from '@/lib/utils';
import { useCountdown } from '@/lib/hooks';
import { DEMO_VERIFICATION_CODE } from '@/data/users';
import { RESEND_COOLDOWN_SECONDS, verifyCode } from '@/services/authService';

const CODE_LENGTH = 6;
const MAX_ATTEMPTS = 5;

type CodeState = 'typing' | 'validating' | 'error' | 'too-many';

const ERROR_MESSAGES: Partial<Record<CodeState, string>> = {
  error: 'Código incorreto. Tente novamente.',
  'too-many': 'Muitas tentativas. Peça um novo código.',
};

interface CodeVerificationProps {
  destination: string;
  onVerified: () => void;
  onChangeDestination?: () => void;
}

/** Entrada de código de 6 dígitos com reenvio após tempo mínimo (fichas 06, 44, 53, 65). */
export default function CodeVerification({ destination, onVerified, onChangeDestination }: CodeVerificationProps) {
  const [digits, setDigits] = useState<string[]>(Array(CODE_LENGTH).fill(''));
  const [state, setState] = useState<CodeState>('typing');
  const [attempts, setAttempts] = useState(0);
  const [resent, setResent] = useState(false);
  const { secondsLeft, restart } = useCountdown(RESEND_COOLDOWN_SECONDS);
  const inputRefs = useRef<(HTMLInputElement | null)[]>([]);
  const locked = state === 'validating' || state === 'too-many';

  async function submit(code: string) {
    setState('validating');
    if (await verifyCode(code)) {
      onVerified();
      return;
    }
    const nextAttempts = attempts + 1;
    setAttempts(nextAttempts);
    setState(nextAttempts >= MAX_ATTEMPTS ? 'too-many' : 'error');
    setDigits(Array(CODE_LENGTH).fill(''));
    inputRefs.current[0]?.focus();
  }

  function handleDigit(index: number, value: string) {
    if (locked) return;
    const digit = value.replace(/\D/g, '').slice(-1);
    const next = [...digits];
    next[index] = digit;
    setDigits(next);
    if (state === 'error') setState('typing');
    if (digit && index < CODE_LENGTH - 1) inputRefs.current[index + 1]?.focus();
    const code = next.join('');
    if (code.length === CODE_LENGTH) void submit(code);
  }

  function handleKeyDown(index: number, event: KeyboardEvent) {
    if (event.key === 'Backspace' && !digits[index] && index > 0) inputRefs.current[index - 1]?.focus();
  }

  function handleResend() {
    setDigits(Array(CODE_LENGTH).fill(''));
    setState('typing');
    setAttempts(0);
    restart();
    setResent(true);
    setTimeout(() => setResent(false), 3000);
    inputRefs.current[0]?.focus();
  }

  return (
    <div className="flex flex-col gap-6">
      <p className="text-muted-foreground text-sm leading-relaxed">
        Enviamos um código de 6 dígitos para <strong className="text-foreground">{destination}</strong>
      </p>

      <div className="flex gap-2.5 justify-between">
        {digits.map((digit, index) => (
          <input
            key={index}
            ref={element => { inputRefs.current[index] = element; }}
            type="text"
            inputMode="numeric"
            autoComplete={index === 0 ? 'one-time-code' : 'off'}
            maxLength={1}
            value={digit}
            autoFocus={index === 0}
            aria-label={`Dígito ${index + 1}`}
            onChange={event => handleDigit(index, event.target.value)}
            onKeyDown={event => handleKeyDown(index, event)}
            // readOnly (e não disabled) para o foco voltar ao 1º campo logo após um erro.
            readOnly={locked}
            className={cn(
              'w-12 h-14 text-center text-xl font-display font-bold rounded-xl border-2 bg-card focus:outline-none focus:border-primary transition-colors',
              locked && 'opacity-50',
              state === 'error' ? 'border-error' : digit ? 'border-primary text-foreground' : 'border-border text-muted-foreground',
            )}
          />
        ))}
      </div>

      {state === 'validating' && (
        <div className="flex items-center gap-2 text-muted-foreground text-sm">
          <Loader2 size={14} className="animate-spin" />
          Validando...
        </div>
      )}
      {ERROR_MESSAGES[state] && <p className="text-error text-sm">{ERROR_MESSAGES[state]}</p>}
      {resent && <p className="text-success text-sm">Código reenviado!</p>}

      <div className="flex items-center gap-3 flex-wrap">
        {secondsLeft > 0 ? (
          <p className="text-muted-foreground text-sm">
            Reenviar código em <strong>{formatCountdown(secondsLeft)}</strong>
          </p>
        ) : (
          <button onClick={handleResend} className="text-primary text-sm font-medium">Reenviar código</button>
        )}
        {onChangeDestination && (
          <>
            <span className="text-border">·</span>
            <button onClick={onChangeDestination} className="text-muted-foreground text-sm hover:text-foreground">Alterar</button>
          </>
        )}
      </div>

      {import.meta.env.DEV && (
        <div className="bg-muted rounded-xl p-4">
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">Dev:</strong> use o código <strong className="text-primary font-display">{DEMO_VERIFICATION_CODE}</strong>
          </p>
        </div>
      )}
    </div>
  );
}
