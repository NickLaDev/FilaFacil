import { useState, type FormEvent } from 'react';
import { Building2, Edit3, Eye, Plus, X } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import FormField, { PANEL_INPUT_CLASS } from '@/components/ui/FormField';
import Modal from '@/components/ui/Modal';
import { ORGANIZATIONS } from '@/data/establishments';
import { cn, formatDate } from '@/lib/utils';
import {
  getOrganizationName,
  saveEstablishment,
  setEstablishmentStatus,
  useEstablishments,
  type EstablishmentInput,
} from '@/services/establishmentService';
import { usePlans } from '@/services/planService';
import { usePlatformUsers } from '@/services/platformUserService';
import type { Establishment, EstablishmentStatus, EstablishmentType } from '@/types/establishment';
import ConfirmDialog from '../components/ConfirmDialog';
import FilterChips, { type FilterOption } from '../components/FilterChips';
import { EstablishmentStatusPill, PlanPill } from '../components/Pills';
import SearchBox from '../components/SearchBox';

type StatusFilter = 'all' | EstablishmentStatus;

const TABLE_HEADERS = ['Estabelecimento', 'Cidade', 'Organização', 'Plano', 'Status', 'Entrada', 'Ações'];
const ESTABLISHMENT_TYPES: EstablishmentType[] = ['Bar', 'Restaurante', 'Cantina', 'Lanchonete'];
const STATUS_OPTIONS: { id: EstablishmentStatus; label: string }[] = [
  { id: 'active', label: 'Ativo' },
  { id: 'inactive', label: 'Inativo' },
  { id: 'suspended', label: 'Suspenso' },
];

type ActionTone = 'success' | 'neutral' | 'danger';

const STATUS_ACTIONS: Record<EstablishmentStatus, { status: EstablishmentStatus; label: string; tone: ActionTone }[]> = {
  active: [
    { status: 'inactive', label: 'Desativar', tone: 'neutral' },
    { status: 'suspended', label: 'Suspender', tone: 'danger' },
  ],
  inactive: [
    { status: 'active', label: 'Reativar', tone: 'success' },
    { status: 'suspended', label: 'Suspender', tone: 'danger' },
  ],
  suspended: [{ status: 'active', label: 'Reativar', tone: 'success' }],
};

const ACTION_TONE_CLASS: Record<ActionTone, string> = {
  success: 'bg-success/10 text-success hover:bg-success/20',
  neutral: 'bg-muted text-foreground hover:bg-muted/80',
  danger: 'bg-error/10 text-error hover:bg-error/20',
};

// Texto do aviso deixa claro o efeito imediato para o cliente (avaliação da ficha 34).
const STATUS_CHANGE_COPY: Record<EstablishmentStatus, { title: string; description: string; done: string }> = {
  active: {
    title: 'Reativar',
    description: 'O estabelecimento volta a aparecer nas buscas do cliente e a aceitar pedidos.',
    done: 'reativado',
  },
  inactive: {
    title: 'Desativar',
    description: 'Some das buscas do cliente e para de aceitar pedidos imediatamente. É possível reativar depois.',
    done: 'desativado',
  },
  suspended: {
    title: 'Suspender',
    description:
      'Some das buscas do cliente e para de aceitar pedidos imediatamente. Use em bloqueios administrativos (ex.: inadimplência).',
    done: 'suspenso',
  },
};

/** "AAAA-MM-DD" lido no fuso local — senão a data volta um dia no horário do Brasil. */
const parseLocalDate = (value: string) => new Date(value.length === 10 ? `${value}T00:00:00` : value);

interface Props {
  notify: (message: string) => void;
}

export default function EstablishmentsSection({ notify }: Props) {
  const establishments = useEstablishments();
  const plans = usePlans();
  const users = usePlatformUsers();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Establishment | 'new' | null>(null);
  const [statusChange, setStatusChange] = useState<{ establishment: Establishment; status: EstablishmentStatus } | null>(null);

  const planName = (planId: string) => plans.find(p => p.id === planId)?.name ?? '—';
  const query = search.trim().toLowerCase();
  const matchesQuery = (e: Establishment) => e.name.toLowerCase().includes(query) || e.city.toLowerCase().includes(query);
  const filtered = establishments.filter(e => (statusFilter === 'all' || e.status === statusFilter) && matchesQuery(e));
  const selected = establishments.find(e => e.id === selectedId) ?? null;

  const countByStatus = (status: EstablishmentStatus) => establishments.filter(e => e.status === status).length;
  const filterOptions: FilterOption<StatusFilter>[] = [
    { id: 'all', label: 'Todos', count: establishments.length },
    { id: 'active', label: 'Ativos', count: countByStatus('active') },
    { id: 'inactive', label: 'Inativos', count: countByStatus('inactive') },
    { id: 'suspended', label: 'Suspensos', count: countByStatus('suspended') },
  ];

  function confirmStatusChange() {
    if (!statusChange) return;
    setEstablishmentStatus(statusChange.establishment.id, statusChange.status);
    notify(`${statusChange.establishment.name} ${STATUS_CHANGE_COPY[statusChange.status].done}`);
    setStatusChange(null);
  }

  return (
    <div className="p-6 flex gap-6 items-start">
      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          <SearchBox value={search} onChange={setSearch} placeholder="Buscar estabelecimento ou cidade..." />
          <button
            onClick={() => setEditing('new')}
            className="flex items-center gap-2 bg-primary text-white px-3 py-2 rounded-xl text-sm font-medium hover:bg-primary/90"
          >
            <Plus size={13} />
            Novo
          </button>
        </div>
        <FilterChips options={filterOptions} value={statusFilter} onChange={setStatusFilter} label="Filtrar por status" />

        <div className="bg-card border border-border rounded-xl overflow-x-auto">
          {filtered.length === 0 ? (
            <EmptyState icon={Building2} title="Nenhum estabelecimento encontrado" description="Ajuste a busca ou o filtro de status." />
          ) : (
            <table className="w-full min-w-[760px]">
              <thead>
                <tr className="border-b border-border bg-muted/30">
                  {TABLE_HEADERS.map(header => (
                    <th key={header} className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(e => (
                  <tr
                    key={e.id}
                    onClick={() => setSelectedId(e.id === selectedId ? null : e.id)}
                    className={cn(
                      'border-b border-border last:border-0 cursor-pointer transition-colors',
                      e.id === selectedId ? 'bg-primary/5' : 'hover:bg-muted/10',
                    )}
                  >
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-foreground">{e.name}</p>
                      <p className="text-xs text-muted-foreground">{e.type}</p>
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{e.city}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">{getOrganizationName(e.organizationId)}</td>
                    <td className="px-4 py-3">
                      <PlanPill name={planName(e.planId)} />
                    </td>
                    <td className="px-4 py-3">
                      <EstablishmentStatusPill status={e.status} />
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">{formatDate(parseLocalDate(e.createdAt))}</td>
                    <td className="px-4 py-3" onClick={event => event.stopPropagation()}>
                      <div className="flex items-center gap-3">
                        <button onClick={() => setSelectedId(e.id)} className="text-xs text-primary font-medium flex items-center gap-1">
                          <Eye size={11} />
                          Ver
                        </button>
                        <button
                          onClick={() => setEditing(e)}
                          className="text-xs text-muted-foreground hover:text-foreground font-medium flex items-center gap-1"
                        >
                          <Edit3 size={11} />
                          Editar
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {selected && (
        <aside className="w-72 bg-card border border-border rounded-xl p-5 flex-shrink-0 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-2">
            <p className="font-display font-bold text-foreground">{selected.name}</p>
            <button onClick={() => setSelectedId(null)} aria-label="Fechar detalhes">
              <X size={14} className="text-muted-foreground" />
            </button>
          </div>
          <div className="flex flex-col gap-2 text-sm">
            {[
              { label: 'Cidade', value: selected.city },
              { label: 'Endereço', value: selected.address },
              { label: 'Organização', value: getOrganizationName(selected.organizationId) },
              { label: 'Plano', value: planName(selected.planId) },
              {
                label: 'Gestor',
                value: users.find(u => u.role === 'manager' && u.establishmentId === selected.id)?.name ?? '—',
              },
              { label: 'Membro desde', value: formatDate(parseLocalDate(selected.createdAt)) },
            ].map(({ label, value }) => (
              <div key={label} className="flex justify-between gap-3 py-1.5 border-b border-border">
                <span className="text-muted-foreground flex-shrink-0">{label}</span>
                <span className="font-medium text-foreground text-right">{value}</span>
              </div>
            ))}
            <div className="flex justify-between items-center gap-3 py-1.5">
              <span className="text-muted-foreground">Status</span>
              <EstablishmentStatusPill status={selected.status} />
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => setEditing(selected)}
              className="w-full bg-primary text-white text-sm font-medium py-2 rounded-lg hover:bg-primary/90"
            >
              Editar dados
            </button>
            {STATUS_ACTIONS[selected.status].map(action => (
              <button
                key={action.status}
                onClick={() => setStatusChange({ establishment: selected, status: action.status })}
                className={cn('w-full text-sm font-medium py-2 rounded-lg transition-colors', ACTION_TONE_CLASS[action.tone])}
              >
                {action.label}
              </button>
            ))}
          </div>
        </aside>
      )}

      {editing && (
        <EstablishmentFormModal
          establishment={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={message => {
            notify(message);
            setEditing(null);
          }}
        />
      )}

      {statusChange && (
        <ConfirmDialog
          title={`${STATUS_CHANGE_COPY[statusChange.status].title} ${statusChange.establishment.name}?`}
          description={STATUS_CHANGE_COPY[statusChange.status].description}
          confirmLabel={STATUS_CHANGE_COPY[statusChange.status].title}
          tone={statusChange.status === 'active' ? 'primary' : 'danger'}
          onConfirm={confirmStatusChange}
          onClose={() => setStatusChange(null)}
        />
      )}
    </div>
  );
}

// ─── Formulário ─────────────────────────────────────────────────────────────

type FormErrors = Partial<Record<keyof EstablishmentInput, string>>;

const toInput = ({ name, city, address, type, organizationId, planId, status }: Establishment): EstablishmentInput => ({
  name, city, address, type, organizationId, planId, status,
});

function validate(input: EstablishmentInput, validPlanIds: string[]): FormErrors {
  const errors: FormErrors = {};
  if (input.name.length < 2) errors.name = 'Informe o nome do estabelecimento.';
  if (!input.city) errors.city = 'Informe a cidade.';
  if (!input.address) errors.address = 'Informe o endereço.';
  if (!ORGANIZATIONS.some(o => o.id === input.organizationId)) errors.organizationId = 'Selecione a organização.';
  if (!validPlanIds.includes(input.planId)) errors.planId = 'Selecione um plano.';
  return errors;
}

interface FormModalProps {
  establishment: Establishment | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

function EstablishmentFormModal({ establishment, onClose, onSaved }: FormModalProps) {
  const plans = usePlans();
  const [form, setForm] = useState<EstablishmentInput>(() =>
    establishment
      ? toInput(establishment)
      : { name: '', city: '', address: '', type: 'Bar', organizationId: ORGANIZATIONS[0].id, planId: plans[0]?.id ?? '', status: 'active' },
  );
  const [errors, setErrors] = useState<FormErrors>({});

  const update = <K extends keyof EstablishmentInput>(key: K, value: EstablishmentInput[K]) =>
    setForm(prev => ({ ...prev, [key]: value }));

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const input = { ...form, name: form.name.trim(), city: form.city.trim(), address: form.address.trim() };
    const nextErrors = validate(input, plans.map(p => p.id));
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    saveEstablishment(input, establishment?.id);
    onSaved(establishment ? 'Alterações salvas' : `${input.name} cadastrado`);
  }

  return (
    <Modal title={establishment ? 'Editar estabelecimento' : 'Novo estabelecimento'} onClose={onClose} width="md">
      <form onSubmit={handleSubmit} noValidate className="flex flex-col gap-4">
        <FormField label="Nome" htmlFor="est-name" error={errors.name}>
          <input id="est-name" value={form.name} onChange={e => update('name', e.target.value)} maxLength={80} className={PANEL_INPUT_CLASS} />
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Cidade" htmlFor="est-city" error={errors.city}>
            <input id="est-city" value={form.city} onChange={e => update('city', e.target.value)} maxLength={60} className={PANEL_INPUT_CLASS} />
          </FormField>
          <FormField label="Tipo" htmlFor="est-type">
            <select
              id="est-type"
              value={form.type}
              onChange={e => update('type', e.target.value as EstablishmentType)}
              className={PANEL_INPUT_CLASS}
            >
              {ESTABLISHMENT_TYPES.map(type => (
                <option key={type} value={type}>
                  {type}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        <FormField label="Endereço" htmlFor="est-address" error={errors.address}>
          <input
            id="est-address"
            value={form.address}
            onChange={e => update('address', e.target.value)}
            maxLength={120}
            placeholder="Rua, número · bairro"
            className={PANEL_INPUT_CLASS}
          />
        </FormField>
        <FormField
          label="Organização"
          htmlFor="est-org"
          error={errors.organizationId}
          hint="Vincula o estabelecimento à rede/grupo responsável."
        >
          <select id="est-org" value={form.organizationId} onChange={e => update('organizationId', e.target.value)} className={PANEL_INPUT_CLASS}>
            {ORGANIZATIONS.map(org => (
              <option key={org.id} value={org.id}>
                {org.name}
              </option>
            ))}
          </select>
        </FormField>
        <div className="grid grid-cols-2 gap-3">
          <FormField label="Plano" htmlFor="est-plan" error={errors.planId}>
            <select id="est-plan" value={form.planId} onChange={e => update('planId', e.target.value)} className={PANEL_INPUT_CLASS}>
              {plans.map(plan => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Status" htmlFor="est-status" hint={form.status === 'active' ? undefined : 'Não aparece nas buscas do cliente.'}>
            <select
              id="est-status"
              value={form.status}
              onChange={e => update('status', e.target.value as EstablishmentStatus)}
              className={PANEL_INPUT_CLASS}
            >
              {STATUS_OPTIONS.map(option => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormField>
        </div>
        <div className="flex gap-2 mt-2">
          <button type="button" onClick={onClose} className="flex-1 border border-border text-foreground py-3 rounded-xl text-sm font-medium hover:bg-muted">
            Cancelar
          </button>
          <button type="submit" className="flex-1 bg-primary text-white py-3 rounded-xl text-sm font-semibold hover:bg-primary/90">
            {establishment ? 'Salvar alterações' : 'Cadastrar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
