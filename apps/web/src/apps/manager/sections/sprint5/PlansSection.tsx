import { useState } from 'react';
import { Check, Crown, Minus } from 'lucide-react';
import { PLAN_FEATURE_LABELS, PLAN_FEATURES, type PlanOptionDto } from '@filafacil/shared';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { useAsyncAction } from '@/lib/useAsyncAction';
import { cn, formatCents } from '@/lib/utils';
import { formatPlanLimit } from '@/services/planService';
import { changePlan, usePlanOptions } from '@/services/sprint5Service';
import ConfirmDialog from '../../components/ConfirmDialog';
import type { ManagerSectionProps } from '../../types';

/**
 * Fichas 69 e 58: planos lado a lado (o atual destacado, diferenças marcadas) e troca self-service com o valor
 * proporcional calculado pelo servidor. Recursos valem na hora; a confirmação também vai por e-mail.
 */
export default function PlansSection({ unit, notify }: ManagerSectionProps) {
  const query = usePlanOptions(unit.id);
  const { run, pending } = useAsyncAction(notify);
  const [target, setTarget] = useState<PlanOptionDto | null>(null);

  if (query.error && !query.data) return <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />;
  if (!query.data) return <LoadingBlock />;
  const { plans, remainingDays, daysInMonth } = query.data;
  const current = plans.find(plan => plan.current);
  const differs = (pick: (plan: PlanOptionDto) => unknown) => new Set(plans.map(plan => JSON.stringify(pick(plan)))).size > 1;

  const rows: { label: string; render: (plan: PlanOptionDto) => React.ReactNode; differs: boolean }[] = [
    { label: 'Mensalidade', render: plan => <span className="font-semibold">{formatCents(plan.monthlyPriceCents)}</span>, differs: differs(plan => plan.monthlyPriceCents) },
    { label: 'Unidades', render: plan => formatPlanLimit(plan.limits.units), differs: differs(plan => plan.limits.units) },
    { label: 'Mesas', render: plan => formatPlanLimit(plan.limits.tables), differs: differs(plan => plan.limits.tables) },
    { label: 'Equipe', render: plan => formatPlanLimit(plan.limits.staff), differs: differs(plan => plan.limits.staff) },
    ...PLAN_FEATURES.map(feature => ({
      label: PLAN_FEATURE_LABELS[feature],
      render: (plan: PlanOptionDto) => (plan.features.includes(feature) ? <Check size={16} className="text-success mx-auto" aria-label="Incluído" /> : <Minus size={16} className="text-muted-foreground mx-auto" aria-label="Não incluído" />),
      differs: differs(plan => plan.features.includes(feature)),
    })),
  ];

  const prorationText = (plan: PlanOptionDto) =>
    plan.prorationCents > 0
      ? `Cobrança proporcional hoje: ${formatCents(plan.prorationCents)} (${remainingDays} de ${daysInMonth} dias).`
      : plan.prorationCents < 0
        ? `Crédito de ${formatCents(-plan.prorationCents)} na próxima mensalidade (${remainingDays} de ${daysInMonth} dias).`
        : 'Sem cobrança proporcional: o novo valor entra na próxima mensalidade.';

  return (
    <div className="p-6 flex flex-col gap-4 max-w-6xl">
      <p className="text-sm text-muted-foreground">Plano atual: <strong className="text-foreground">{current?.name}</strong>. As linhas destacadas são as diferenças entre os planos. Trocar vale na hora; a diferença dos dias restantes do mês é cobrada (upgrade) ou vira crédito (downgrade).</p>
      <div className="bg-card rounded-xl border border-border overflow-x-auto">
        <table className="w-full min-w-[560px]" data-testid="plan-comparison">
          <thead>
            <tr>
              <th className="px-4 py-3 text-left text-xs text-muted-foreground uppercase tracking-wider w-48">Recurso</th>
              {plans.map(plan => (
                <th key={plan.id} data-testid="plan-column" data-current={plan.current} className={cn('px-4 py-3 text-center', plan.current && 'bg-primary/10')}>
                  <span className="font-display text-base font-bold text-foreground inline-flex items-center gap-1">{plan.current && <Crown size={14} className="text-primary" />}{plan.name}</span>
                  {plan.current && <span className="block text-[11px] font-semibold text-primary">Seu plano</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.label} className={cn('border-t border-border text-sm', row.differs && 'bg-warning-bg/30')}>
                <td className="px-4 py-2.5 text-muted-foreground">{row.label}</td>
                {plans.map(plan => (
                  <td key={plan.id} className={cn('px-4 py-2.5 text-center', plan.current && 'bg-primary/5')}>{row.render(plan)}</td>
                ))}
              </tr>
            ))}
            <tr className="border-t border-border">
              <td />
              {plans.map(plan => (
                <td key={plan.id} className={cn('px-3 py-3 text-center align-top', plan.current && 'bg-primary/5')}>
                  {plan.current ? (
                    <span className="text-xs text-muted-foreground">Plano atual</span>
                  ) : (
                    <div className="flex flex-col gap-1.5 items-center">
                      <button disabled={plan.blockers.length > 0 || pending} onClick={() => setTarget(plan)} data-testid={`switch-${plan.name}`} className="bg-primary text-primary-foreground rounded-xl px-3 py-2 text-sm font-medium disabled:opacity-40 w-full">
                        {current && plan.monthlyPriceCents > current.monthlyPriceCents ? 'Fazer upgrade' : 'Mudar para este'}
                      </button>
                      {plan.blockers.map(blocker => <span key={blocker} className="text-[11px] text-error">{blocker}</span>)}
                    </div>
                  )}
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
      {target && (
        <ConfirmDialog
          title={`Trocar para ${target.name}?`}
          message={`${current?.name} → ${target.name} (${formatCents(target.monthlyPriceCents)}/mês). ${prorationText(target)} Os recursos mudam agora e você recebe a confirmação por e-mail.`}
          confirmLabel="Confirmar troca"
          onConfirm={() =>
            run(() => changePlan(unit.id, target.id), `Plano alterado para ${target.name}. Recursos já liberados.`).then(() => {
              setTarget(null);
              void query.refetch();
            })
          }
          onClose={() => setTarget(null)}
        />
      )}
    </div>
  );
}
