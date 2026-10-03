import Modal from '@/components/ui/Modal';
import { cn } from '@/lib/utils';

interface ConfirmDialogProps {
  title: string;
  description: string;
  confirmLabel: string;
  tone?: 'primary' | 'danger';
  onConfirm: () => void;
  onClose: () => void;
}

export default function ConfirmDialog({ title, description, confirmLabel, tone = 'primary', onConfirm, onClose }: ConfirmDialogProps) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-sm text-muted-foreground leading-relaxed">{description}</p>
      <div className="flex gap-3 mt-5">
        <button onClick={onClose} className="flex-1 border border-border rounded-xl py-2.5 text-sm text-muted-foreground hover:bg-muted">
          Cancelar
        </button>
        <button
          onClick={onConfirm}
          className={cn('flex-1 rounded-xl py-2.5 text-sm font-semibold text-white', tone === 'danger' ? 'bg-error hover:bg-error/90' : 'bg-primary hover:bg-primary/90')}
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
