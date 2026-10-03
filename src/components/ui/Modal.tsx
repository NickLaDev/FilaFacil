import { useEffect, type ReactNode } from 'react';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

const WIDTHS = { sm: 'max-w-sm', md: 'max-w-md', lg: 'max-w-2xl' };

interface ModalProps {
  title?: string;
  onClose: () => void;
  children: ReactNode;
  width?: keyof typeof WIDTHS;
}

export default function Modal({ title, onClose, children, width = 'sm' }: ModalProps) {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cn('bg-card rounded-2xl p-6 w-full shadow-xl max-h-[90vh] overflow-y-auto', WIDTHS[width])}
        onClick={event => event.stopPropagation()}
      >
        {title && (
          <div className="flex items-center justify-between mb-4 gap-3">
            <h3 className="font-display font-bold text-foreground text-lg">{title}</h3>
            <button onClick={onClose} className="p-1.5 hover:bg-muted rounded-lg text-muted-foreground" aria-label="Fechar">
              <X size={18} />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
