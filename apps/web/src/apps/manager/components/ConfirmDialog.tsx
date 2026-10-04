import { useState } from 'react';
import Modal from '@/components/ui/Modal';

interface ConfirmDialogProps {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void | Promise<unknown>;
  onClose: () => void;
}

export default function ConfirmDialog({ title, message, confirmLabel, onConfirm, onClose }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);

  async function confirm() {
    setBusy(true);
    try {
      await onConfirm();
    } finally {
      setBusy(false);
      onClose();
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <p className="text-sm text-muted-foreground leading-relaxed">{message}</p>
      <div className="flex gap-3 mt-5">
        <button onClick={onClose} disabled={busy} className="flex-1 border border-border rounded-xl py-2.5 text-sm text-muted-foreground hover:bg-muted disabled:opacity-60">
          Cancelar
        </button>
        <button onClick={() => void confirm()} disabled={busy} className="flex-1 bg-error text-white rounded-xl py-2.5 text-sm font-semibold disabled:opacity-60">
          {busy ? 'Aguarde…' : confirmLabel}
        </button>
      </div>
    </Modal>
  );
}
