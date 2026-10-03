import type { ReactNode } from 'react';

interface BottomSheetProps {
  onClose: () => void;
  children: ReactNode;
}

/** Sheet do app do cliente, limitado à largura do frame mobile. */
export default function BottomSheet({ onClose, children }: BottomSheetProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        className="bg-card rounded-t-3xl w-full max-w-[390px] px-6 pt-6 pb-10 animate-slide-up max-h-[90vh] overflow-y-auto"
        onClick={event => event.stopPropagation()}
      >
        <div className="w-10 h-1 bg-border rounded-full mx-auto mb-6" />
        {children}
      </div>
    </div>
  );
}
