import type { ReactNode } from 'react';

/** Estilo dos campos dos painéis (gestor, atendente, admin). */
export const PANEL_INPUT_CLASS =
  'w-full border border-border rounded-xl px-3 py-2.5 text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-primary disabled:opacity-60';

interface FormFieldProps {
  label: string;
  htmlFor?: string;
  error?: string;
  hint?: string;
  children: ReactNode;
}

export default function FormField({ label, htmlFor, error, hint, children }: FormFieldProps) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-xs text-muted-foreground font-medium mb-1.5 block">
        {label}
      </label>
      {children}
      {error ? <p className="text-error text-xs mt-1.5">{error}</p> : hint && <p className="text-muted-foreground text-xs mt-1.5">{hint}</p>}
    </div>
  );
}
