import { CheckCircle2 } from 'lucide-react';

export default function Toast({ message }: { message: string | null }) {
  if (!message) return null;
  return (
    <div className="fixed top-4 left-4 right-4 z-[60] flex justify-center pointer-events-none" role="status" aria-live="polite">
      <div className="bg-foreground text-background text-sm font-medium px-4 py-2.5 rounded-xl shadow-xl flex items-center gap-2">
        <CheckCircle2 size={15} className="text-success flex-shrink-0" />
        {message}
      </div>
    </div>
  );
}
