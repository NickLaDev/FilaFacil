import { useState } from 'react';
import { Bell, QrCode, ShoppingBag, type LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Slide {
  icon: LucideIcon;
  title: string;
  description: string;
}

const SLIDES: Slide[] = [
  { icon: QrCode, title: 'Escaneie o QR da mesa', description: 'Aponte a câmera para o QR Code da sua mesa e abra o cardápio do bar na hora.' },
  { icon: ShoppingBag, title: 'Peça e pague pelo celular', description: 'Monte o pedido, pague pelo app e acompanhe cada etapa sem esperar na fila.' },
  { icon: Bell, title: 'Receba o aviso quando ficar pronto', description: 'Avisamos você assim que o pedido estiver pronto e mostramos sua posição na fila.' },
];

interface Props {
  /** Chamado ao concluir ou pular; quem chama persiste que a conta já viu o onboarding. */
  onFinish: (skipped: boolean) => void;
}

/** Ficha 07: três telas leves, puláveis, exibidas no primeiro acesso da conta. */
export default function OnboardingScreen({ onFinish }: Props) {
  const [index, setIndex] = useState(0);
  const slide = SLIDES[index];
  const last = index === SLIDES.length - 1;
  const Icon = slide.icon;

  return (
    <div className="fixed inset-0 z-[60] overflow-auto bg-background flex flex-col" data-testid="onboarding" role="dialog" aria-modal="true" aria-label="Boas-vindas">
      <div className="flex justify-end px-6 pt-6">
        <button onClick={() => onFinish(true)} className="text-sm text-muted-foreground font-medium py-2 px-3">
          Pular
        </button>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center px-10 text-center gap-5">
        <div className="w-24 h-24 rounded-3xl bg-primary/10 flex items-center justify-center">
          <Icon size={44} className="text-primary" />
        </div>
        <h1 className="font-display font-extrabold text-foreground text-2xl leading-tight">{slide.title}</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">{slide.description}</p>
        <p className="sr-only" aria-live="polite">Passo {index + 1} de {SLIDES.length}</p>
      </div>
      <div className="px-6 pb-10 flex flex-col gap-5">
        <div className="flex justify-center gap-2" aria-hidden="true">
          {SLIDES.map((_, i) => (
            <span key={i} className={cn('h-1.5 rounded-full transition-all', i === index ? 'w-6 bg-primary' : 'w-1.5 bg-border')} />
          ))}
        </div>
        <button
          onClick={() => (last ? onFinish(false) : setIndex(index + 1))}
          className="w-full bg-primary text-primary-foreground font-display font-semibold py-4 rounded-xl"
        >
          {last ? 'Começar' : 'Próximo'}
        </button>
      </div>
    </div>
  );
}
