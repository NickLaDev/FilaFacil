import { useState, type FormEvent } from 'react';
import { CheckCircle2, Edit3, Plus, Trash2, XCircle } from 'lucide-react';
import FormField, { PANEL_INPUT_CLASS } from '@/components/ui/FormField';
import Modal from '@/components/ui/Modal';
import { PLAN_FEATURE_LABELS, UNLIMITED } from '@/data/establishments';
import { cn, formatCurrency } from '@/lib/utils';
import { getOrganizationName, setEstablishmentPlan, useEstablishments } from '@/services/establishmentService';
import { deletePlan, formatPlanLimit, savePlan, usePlans } from '@/services/planService';
import type { Establishment, Plan, PlanFeature } from '@/types/establishment';
import ConfirmDialog from '../components/ConfirmDialog';
import { EstablishmentStatusPill } from '../components/Pills';

type LimitKey = keyof Plan['limits'];

const FEATURES = Object.entries(PLAN_FEATURE_LABELS) as [PlanFeature, string][];
const LIMITS: { key: LimitKey; label: string }[] = [
  { key: 'units', label: 'Unidades' },
  { key: 'tables', label: 'Mesas' },
  { key: 'staff', label: 'Equipe' },
];

interface Props {
  notify: (message: string) => void;
}

export default function PlansSection({ notify }: Props) {
  const plans = usePlans();
  const establishments = useEstablishments();
  const [editing, setEditing] = useState<Plan | 'new' | null>(null);
  const [deleting, setDeleting] = useState<Plan | null>(null);

  const usageCount = (planId: string) => establishments.filter(e => e.planId === planId).length;

  function confirmDelete() {
    if (!deleting) return;
    // Revalida no momento da exclusão: o plano pode ter sido vinculado nesse meio-tempo.
    if (usageCount(deleting.id) === 0) {
      deletePlan(deleting.id);
      notify(`Plano ${deleting.name} excluído`);
    }
    setDeleting(null);
  }

  function changePlan(establishment: Establishment, planId: string) {
    setEstablishmentPlan(establishment.id, planId);
    notify(`${establishment.name} migrado para o plano ${plans.find(p => p.id === planId)?.name ?? ''}`);
  }

  return (
    <div className="p-6 flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {plans.length} plano{plans.length === 1 ? '' : 's'} de assinatura
        </p>
        <button
          onClick={() => setEditing('new')}
          className="flex items-center gap-2 bg-primary text-white px-4 py-2 rounded-xl text-sm font-medium hover:bg-primary/90"
        >
          <Plus size={14} />
          Novo plano
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {plans.map(plan => {
          const inUse = usageCount(plan.id);
          return (
            <div key={plan.id} className="bg-card border-2 border-border rounded-xl p-5 flex flex-col">
              <div className="flex items-start justify-between gap-2">
                <p className="font-display font-bold text-foreground">{plan.name}</p>
                <span className="text-[10px] font-bold text-muted-foreground bg-muted px-2 py-0.5 rounded-full whitespace-nowrap">
                  {inUse} estabelecimento{inUse === 1 ? '' : 's'}
                </span>
              </div>
              <p className="font-display font-bold text-2xl text-foreground mt-1">
                {formatCurrency(plan.monthlyPrice)} <span className="text-sm text-muted-foreground font-normal">/mês</span>
              </p>
              <div className="mt-3 grid grid-cols-3 gap-2 text-center bg-muted/50 rounded-lg py-2">
                {LIMITS.map(({ key, label }) => (
                  <div key={key}>
                    <p className="text-[10px] text-muted-foreground">{label}</p>
                    <p className="text-sm font-bold text-foreground">{formatPlanLimit(plan.limits[key])}</p>
                  </div>
                ))}
              </div>
              <ul className="mt-3 flex flex-col gap-1.5 flex-1">
                {FEATURES.map(([feature, label]) => {
                  const included = plan.features.includes(feature);
                  return (
                    <li
                      key={feature}
                      className={cn('flex items-center gap-2 text-xs', included ? 'text-muted-foreground' : 'text-muted-foreground/50 line-through')}
                    >
                      {included ? (
                        <CheckCircle2 size={11} className="text-success flex-shrink-0" aria-label="Incluído" />
                      ) : (
                        <XCircle size={11} className="flex-shrink-0" aria-label="Não incluído" />
                      )}
                      {label}
                    </li>
                  );
                })}
              </ul>
              <div className="flex gap-2 mt-4">
                <button
                  onClick={() => setEditing(plan)}
                  className="flex-1 flex items-center justify-center gap-1.5 bg-primary text-white text-sm font-medium py-2 rounded-lg hover:bg-primary/90"
                >
                  <Edit3 size={13} />
                  Editar
                </button>
                <button
                  onClick={() => setDeleting(plan)}
                  disabled={inUse > 0}
                  aria-label={`Excluir plano ${plan.name}`}
                  title={inUse > 0 ? 'Migre os estabelecimentos para outro plano antes de excluir.' : undefined}
                  className="p-2 rounded-lg border border-border text-muted-foreground hover:text-error hover:bg-error-bg disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-transparent disabled:hover:text-muted-foreground"
                >
                  <Trash2 size={14} />
                </button>
              </div>
              {inUse > 0 && <p className="text-[10px] text-muted-foreground mt-2">Em uso — migre os estabelecimentos antes de excluir.</p>}
            </div>
          );
        })}
      </div>

      <div className="bg-card border border-border rounded-xl overflow-x-auto">
        <div className="px-5 py-4 border-b border-border">
          <p className="font-semibold text-foreground">Plano por estabelecimento</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            A troca vale na hora: recursos fora do plano ficam bloqueados no painel do gestor (sem novo deploy).
          </p>
        </div>
        <table className="w-full min-w-[620px]">
          <thead>
            <tr className="border-b border-border bg-muted/30">
              {['Estabelecimento', 'Organização', 'Status', 'Plano'].map(header => (
                <th key={header} className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {establishments.map(establishment => (
              <tr key={establishment.id} className="border-b border-border last:border-0 hover:bg-muted/10">
                <td className="px-4 py-3 text-sm font-medium text-foreground">{establishment.name}</td>
                <td className="px-4 py-3 text-sm text-muted-foreground">{getOrganizationName(establishment.organizationId)}</td>
                <td className="px-4 py-3">
                  <EstablishmentStatusPill status={establishment.status} />
                </td>
                <td className="px-4 py-3">
                  <div className="w-44">
                    <select
                      aria-label={`Plano de ${establishment.name}`}
                      value={establishment.planId}
                      onChange={event => changePlan(establishment, event.target.value)}
                      className={PANEL_INPUT_CLASS}
                    >
                      {plans.map(plan => (
                        <option key={plan.id} value={plan.id}>
                          {plan.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <PlanFormModal
          plan={editing === 'new' ? null : editing}
          otherPlanNames={plans.filter(p => editing === 'new' || p.id !== editing.id).map(p => p.name)}
          onClose={() => setEditing(null)}
          onSaved={message => {
            notify(message);
            setEditing(null);
          }}
        />
      )}

      {deleting && (
        <ConfirmDialog
          title={`Excluir plano ${deleting.name}?`}
          description="O plano deixa de estar disponível para novos vínculos. Esta ação não pode ser desfeita."
          confirmLabel="Excluir"
          tone="danger"
          onConfirm={confirmDelete}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

// ─── Formulário ─────────────────────────────────────────────────────────────

interface LimitDraft {
  value: string;
  unlimited: boolean;
}

interface PlanDraft {
  name: string;
  price: string;
  limits: Record<LimitKey, LimitDraft>;
  features: PlanFeature[];
}

interface DraftErrors {
  name?: string;
  price?: string;
  limits?: string;
}

const toLimitDraft = (value: number): LimitDraft =>
  value >= UNLIMITED ? { value: '', unlimited: true } : { value: String(value), unlimited: false };

function toDraft(plan: Plan | null): PlanDraft {
  if (!plan) {
    return {
      name: '',
      price: '',
      limits: { units: toLimitDraft(1), tables: toLimitDraft(15), staff: toLimitDraft(5) },
      features: [],
    };
  }
  return {
    name: plan.name,
    price: String(plan.monthlyPrice),
    limits: { units: toLimitDraft(plan.limits.units), tables: toLimitDraft(plan.limits.tables), staff: toLimitDraft(plan.limits.staff) },
    features: plan.features,
  };
}

const parsePrice = (value: string) => Number(value.replace(',', '.'));

function parseLimit({ value, unlimited }: LimitDraft) {
  if (unlimited) return UNLIMITED;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed < UNLIMITED ? parsed : null;
}

interface PlanFormModalProps {
  plan: Plan | null;
  otherPlanNames: string[];
  onClose: () => void;
  onSaved: (message: string) => void;
}

function PlanFormModal({ plan, otherPlanNames, onClose, onSaved }: PlanFormModalProps) {
  const [draft, setDraft] = useState<PlanDraft>(() => toDraft(plan));
  const [errors, setErrors] = useState<DraftErrors>({});

  const updateLimit = (key: LimitKey, patch: Partial<LimitDraft>) =>
    setDraft(prev => ({ ...prev, limits: { ...prev.limits, [key]: { ...prev.limits[key], ...patch } } }));

  const toggleFeature = (feature: PlanFeature) =>
    setDraft(prev => ({
      ...prev,
      features: prev.features.includes(feature) ? prev.features.filter(f => f !== feature) : [...prev.features, feature],
    }));

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const name = draft.name.trim();
    const price = parsePrice(draft.price);
    const limits = { units: parseLimit(draft.limits.units), tables: parseLimit(draft.limits.tables), staff: parseLimit(draft.limits.staff) };

    const nextErrors: DraftErrors = {};
    if (!name) nextErrors.name = 'Informe o nome do plano.';
    else if (otherPlanNames.some(other => other.toLowerCase() === name.toLowerCase())) nextErrors.name = 'Já existe um plano com esse nome.';
    if (draft.price.trim() === '' || !Number.isFinite(price) || price < 0) nextErrors.price = 'Informe um preço igual ou maior que zero.';
    if (Object.values(limits).some(limit => limit === null)) nextErrors.limits = 'Use números inteiros a partir de 1 ou marque "Ilimitado".';
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0 || limits.units === null || limits.tables === null || limits.staff === null) return;

    savePlan(
      {
        name,
        monthlyPrice: Math.round(price * 100) / 100,
        limits: { units: limits.units, tables: limits.tables, staff: limits.staff },
        features: FEATURES.map(([feature]) => feature).filter(feature => draft.features.includes(feature)),
      },
      plan?.id,
    );
    onSaved(plan ? `Plano ${name} atualizado` : `Plano ${name} criado`);
  }

  return (
    <Modal title={plan ? `Editar plano ${plan.name}` : 'Novo plano'} onClose={onClose} width="md">
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Nome" htmlFor="plan-name" error={errors.name}>
            <input
              id="plan-name"
              value={draft.name}
              onChange={e => setDraft(prev => ({ ...prev, name: e.target.value }))}
              maxLength={40}
              className={PANEL_INPUT_CLASS}
            />
          </FormField>
          <FormField label="Preço mensal (R$)" htmlFor="plan-price" error={errors.price}>
            <input
              id="plan-price"
              type="number"
              inputMode="decimal"
              min={0}
              step="0.01"
              value={draft.price}
              onChange={e => setDraft(prev => ({ ...prev, price: e.target.value }))}
              className={PANEL_INPUT_CLASS}
            />
          </FormField>
        </div>

        <fieldset>
          <legend className="text-xs text-muted-foreground font-medium mb-1.5">Limites</legend>
          <div className="grid grid-cols-3 gap-3">
            {LIMITS.map(({ key, label }) => {
              const limit = draft.limits[key];
              return (
                <div key={key}>
                  <label htmlFor={`plan-limit-${key}`} className="text-xs text-foreground mb-1 block">
                    {label}
                  </label>
                  <input
                    id={`plan-limit-${key}`}
                    type="number"
                    min={1}
                    step={1}
                    disabled={limit.unlimited}
                    value={limit.unlimited ? '' : limit.value}
                    placeholder={limit.unlimited ? 'Ilimitado' : undefined}
                    onChange={e => updateLimit(key, { value: e.target.value })}
                    className={PANEL_INPUT_CLASS}
                  />
                  <label className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground cursor-pointer">
                    <input
                      type="checkbox"
                      checked={limit.unlimited}
                      onChange={e => updateLimit(key, { unlimited: e.target.checked })}
                      className="w-3.5 h-3.5 accent-primary"
                    />
                    Ilimitado
                  </label>
                </div>
              );
            })}
          </div>
          {errors.limits && <p className="text-error text-xs mt-1.5">{errors.limits}</p>}
        </fieldset>

        <fieldset>
          <legend className="text-xs text-muted-foreground font-medium mb-1.5">Recursos incluídos</legend>
          <div className="flex flex-col border border-border rounded-xl divide-y divide-border">
            {FEATURES.map(([feature, label]) => (
              <label key={feature} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-muted/40">
                <input
                  type="checkbox"
                  checked={draft.features.includes(feature)}
                  onChange={() => toggleFeature(feature)}
                  className="w-4 h-4 accent-primary"
                />
                <span className="text-sm text-foreground">{label}</span>
              </label>
            ))}
          </div>
          <p className="text-xs text-muted-foreground mt-1.5">Recursos não marcados ficam bloqueados para os estabelecimentos deste plano.</p>
        </fieldset>

        <div className="flex gap-2">
          <button type="button" onClick={onClose} className="flex-1 border border-border text-foreground py-3 rounded-xl text-sm font-medium hover:bg-muted">
            Cancelar
          </button>
          <button type="submit" className="flex-1 bg-primary text-white py-3 rounded-xl text-sm font-semibold hover:bg-primary/90">
            {plan ? 'Salvar plano' : 'Criar plano'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
