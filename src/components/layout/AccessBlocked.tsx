import { ShieldOff } from 'lucide-react';

interface AccessBlockedProps {
  title?: string;
  description?: string;
  action?: { label: string; onClick: () => void };
}

/** Exibida quando o admin suspende o usuário da sessão aberta (ficha 36). */
export default function AccessBlocked({
  title = 'Acesso suspenso',
  description = 'Seu acesso foi suspenso pelo administrador da plataforma. Fale com o responsável pelo estabelecimento.',
  action,
}: AccessBlockedProps) {
  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-6">
      <div className="bg-card border border-border rounded-2xl p-8 max-w-sm w-full text-center flex flex-col items-center gap-4">
        <div className="w-16 h-16 rounded-2xl bg-error-bg flex items-center justify-center">
          <ShieldOff size={28} className="text-error" />
        </div>
        <div>
          <p className="font-display font-bold text-foreground text-xl">{title}</p>
          <p className="text-muted-foreground text-sm mt-2 leading-relaxed">{description}</p>
        </div>
        {action && (
          <button onClick={action.onClick} className="w-full bg-primary text-primary-foreground font-display font-semibold py-3.5 rounded-xl">
            {action.label}
          </button>
        )}
      </div>
    </div>
  );
}
