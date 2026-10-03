import { Lock } from 'lucide-react';

/** Bloqueio de recurso fora do plano contratado (ficha 37). */
export default function PlanLockedNotice({ feature, planName }: { feature: string; planName?: string }) {
  return (
    <div className="flex items-center justify-center py-24 px-6">
      <div className="text-center max-w-sm">
        <div className="w-16 h-16 rounded-2xl bg-muted flex items-center justify-center mx-auto mb-4">
          <Lock size={24} className="text-muted-foreground" />
        </div>
        <p className="font-display font-bold text-foreground">{feature} não está no seu plano</p>
        <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
          {planName ? `O plano ${planName} não inclui este recurso.` : 'O plano atual não inclui este recurso.'} Fale com a equipe
          da plataforma para migrar de plano.
        </p>
      </div>
    </div>
  );
}
