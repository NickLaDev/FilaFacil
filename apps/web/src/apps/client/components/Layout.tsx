import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ScreenHeaderProps {
  title: string;
  onBack?: () => void;
  right?: ReactNode;
  className?: string;
}

export function ScreenHeader({ title, onBack, right, className }: ScreenHeaderProps) {
  return (
    <div className={cn('bg-card border-b border-border px-4 py-4 flex items-center gap-3', className)}>
      {onBack && (
        <button onClick={onBack} className="p-1.5 -ml-1.5 hover:bg-muted rounded-lg" aria-label="Voltar">
          <ChevronLeft size={20} />
        </button>
      )}
      <h1 className="font-display font-bold text-foreground flex-1">{title}</h1>
      {right}
    </div>
  );
}

/** Botão voltar solto (telas de autenticação, sem barra de título). */
export function BackButton({ onClick }: { onClick: () => void }) {
  return (
    <button onClick={onClick} className="p-1.5 -ml-1.5 hover:bg-muted rounded-lg" aria-label="Voltar">
      <ChevronLeft size={20} />
    </button>
  );
}

/** Rodapé fixo alinhado ao frame mobile (não estica na largura da janela no desktop). */
export function FixedBottom({ children, className, aboveNav }: { children: ReactNode; className?: string; aboveNav?: boolean }) {
  return (
    <div className={cn('fixed left-1/2 -translate-x-1/2 w-full max-w-[390px] px-4 pb-4 z-20', aboveNav ? 'bottom-[61px]' : 'bottom-0', className)}>
      {children}
    </div>
  );
}

/** Tela de resultado centralizada (sucesso, erro, processamento). */
export function ResultScreen({ icon, title, description, children }: { icon: ReactNode; title: string; description?: ReactNode; children?: ReactNode }) {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-5 px-8">
      {icon}
      <div className="text-center">
        <p className="font-display font-bold text-foreground text-xl">{title}</p>
        {description && <p className="text-muted-foreground text-sm mt-1 leading-relaxed">{description}</p>}
      </div>
      {children}
    </div>
  );
}
