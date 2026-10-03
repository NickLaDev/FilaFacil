import Modal from '@/components/ui/Modal';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
  onClose: () => void;
}

export default function ConfirmDialog({ title, message, confirmLabel, onConfirm, onClose }: ConfirmDialogProps) {
  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-sm text-muted-foreground leading-relaxed">{message}</p>
      <div className="flex gap-3 mt-5">
        <button onClick={onClose} className="flex-1 border border-border rounded-xl py-2.5 text-sm text-muted-foreground hover:bg-muted">
          Cancelar
        </button>
        <button
          onClick={() => {
            onConfirm();
            onClose();
          }}
          className="flex-1 bg-error text-white rounded-xl py-2.5 text-sm font-semibold"
        >
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
