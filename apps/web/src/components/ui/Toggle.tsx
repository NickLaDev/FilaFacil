import { cn } from '@/lib/utils';

interface ToggleProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  disabled?: boolean;
  tone?: 'primary' | 'success';
}

export default function Toggle({ checked, onChange, label, disabled, tone = 'primary' }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        'w-11 h-6 rounded-full relative transition-colors flex-shrink-0 disabled:opacity-50 disabled:cursor-not-allowed',
        checked ? (tone === 'success' ? 'bg-success' : 'bg-primary') : 'bg-border',
      )}
    >
      <span
        className={cn(
          'absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform',
          checked && 'translate-x-5',
        )}
      />
    </button>
  );
}
