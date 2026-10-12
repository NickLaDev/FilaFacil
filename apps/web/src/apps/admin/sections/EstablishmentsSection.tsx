import { useState, type ChangeEvent, type FormEvent } from 'react';
import { Building2, Edit3, Eye, ImagePlus, Plus, Trash2, X } from 'lucide-react';
import {
  ESTABLISHMENT_TYPE_LABELS,
  ESTABLISHMENT_TYPES,
  type AdminEstablishmentDto,
  type EstablishmentStatus,
  type EstablishmentType,
} from '@filafacil/shared';
import EmptyState from '@/components/ui/EmptyState';
import FormField, { PANEL_INPUT_CLASS } from '@/components/ui/FormField';
import Modal from '@/components/ui/Modal';
import { QueryState } from '@/components/ui/QueryState';
import { useDebouncedValue } from '@/lib/hooks';
import { useAsyncAction } from '@/lib/useAsyncAction';
import { isApiError } from '@/lib/api/client';
import { cn, formatDate } from '@/lib/utils';
import {
  addEstablishmentPhoto,
  createOrganization,
  removeEstablishmentPhoto,
  saveEstablishment,
  setEstablishmentStatus,
  useAdminEstablishments,
  useOrganizations,
  type EstablishmentInput,
} from '@/services/establishmentService';
import { usePlans } from '@/services/planService';
import ConfirmDialog from '../components/ConfirmDialog';
import FilterChips, { type FilterOption } from '../components/FilterChips';
import Pagination from '../components/Pagination';
import { EstablishmentStatusPill, PlanPill } from '../components/Pills';
import SearchBox from '../components/SearchBox';

type StatusFilter = 'all' | EstablishmentStatus;

const PAGE_SIZE = 20;
const TABLE_HEADERS = ['Estabelecimento', 'Cidade', 'Organização', 'Plano', 'Status', 'Entrada', 'Ações'];
const STATUS_OPTIONS: { id: EstablishmentStatus; label: string }[] = [
  { id: 'active', label: 'Ativo' },
  { id: 'inactive', label: 'Inativo' },
  { id: 'suspended', label: 'Suspenso' },
];
const WEEKDAY_LABELS = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const ACCEPTED_IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_IMAGE_BYTES = 2 * 1024 * 1024;

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
    description: 'Some das buscas do cliente e para de aceitar pedidos imediatamente. A equipe ainda pode configurar a casa. É possível reativar depois.',
    done: 'desativado',
  },
  suspended: {
    title: 'Suspender',
    description:
      'Some das buscas do cliente, para de aceitar pedidos e bloqueia o painel da equipe imediatamente. Use em bloqueios administrativos (ex.: inadimplência).',
    done: 'suspenso',
  },
};

interface Props {
  notify: (message: string) => void;
}

/** Ficha 34: cadastro, edição, vínculo com organização e status (ativo, inativo, suspenso). */
export default function EstablishmentsSection({ notify }: Props) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const query = useAdminEstablishments({ q: useDebouncedValue(search.trim()), status: statusFilter, page, pageSize: PAGE_SIZE });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editing, setEditing] = useState<AdminEstablishmentDto | 'new' | null>(null);
  const [statusChange, setStatusChange] = useState<{ establishment: AdminEstablishmentDto; status: EstablishmentStatus } | null>(null);
  const { run, pending } = useAsyncAction(notify);

  const counts = query.data?.counts;
  const filterOptions: FilterOption<StatusFilter>[] = [
    { id: 'all', label: 'Todos', count: counts?.all },
    { id: 'active', label: 'Ativos', count: counts?.active },
    { id: 'inactive', label: 'Inativos', count: counts?.inactive },
    { id: 'suspended', label: 'Suspensos', count: counts?.suspended },
  ];
  const selected = query.data?.items.find(e => e.id === selectedId) ?? null;

  async function confirmStatusChange() {
    if (!statusChange) return;
    const { establishment, status } = statusChange;
    await run(() => setEstablishmentStatus(establishment.id, status), `${establishment.name} ${STATUS_CHANGE_COPY[status].done}`);
    setStatusChange(null);
  }

  return (
    <div className="p-6 flex gap-6 items-start">
      <div className="flex-1 min-w-0 flex flex-col gap-4">
        <div className="flex items-center gap-3 flex-wrap">
          <SearchBox
            value={search}
            onChange={value => {
              setSearch(value);
              setPage(1);
            }}
            placeholder="Buscar estabelecimento ou cidade..."
          />
          <button
            onClick={() => setEditing('new')}
            className="flex items-center gap-2 bg-primary text-white px-3 py-2 rounded-xl text-sm font-medium hover:bg-primary/90"
          >
            <Plus size={13} />
            Novo
          </button>
        </div>
        <FilterChips
          options={filterOptions}
          value={statusFilter}
          onChange={value => {
            setStatusFilter(value);
            setPage(1);
          }}
          label="Filtrar por status"
        />

        <div className="bg-card border border-border rounded-xl overflow-x-auto">
          <QueryState query={query}>
            {data =>
              data.items.length === 0 ? (
                <EmptyState icon={Building2} title="Nenhum estabelecimento encontrado" description="Ajuste a busca ou o filtro de status." />
              ) : (
                <>
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
                      {data.items.map(e => (
                        <tr
                          key={e.id}
                          onClick={() => setSelectedId(e.id === selectedId ? null : e.id)}
                          className={cn('border-b border-border last:border-0 cursor-pointer transition-colors', e.id === selectedId ? 'bg-primary/5' : 'hover:bg-muted/10')}
                        >
                          <td className="px-4 py-3">
                            <p className="text-sm font-medium text-foreground">{e.name}</p>
                            <p className="text-xs text-muted-foreground">{ESTABLISHMENT_TYPE_LABELS[e.type]}</p>
                          </td>
                          <td className="px-4 py-3 text-sm text-muted-foreground">{e.city}</td>
                          <td className="px-4 py-3 text-sm text-muted-foreground">{e.organization.name}</td>
                          <td className="px-4 py-3">
                            <PlanPill name={e.plan.name} />
                          </td>
                          <td className="px-4 py-3">
                            <EstablishmentStatusPill status={e.status} />
                          </td>
                          <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">{formatDate(e.createdAt)}</td>
                          <td className="px-4 py-3" onClick={event => event.stopPropagation()}>
                            <div className="flex items-center gap-3">
                              <button onClick={() => setSelectedId(e.id)} className="text-xs text-primary font-medium flex items-center gap-1">
                                <Eye size={11} />
                                Ver
                              </button>
                              <button onClick={() => setEditing(e)} className="text-xs text-muted-foreground hover:text-foreground font-medium flex items-center gap-1">
                                <Edit3 size={11} />
                                Editar
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
                </>
              )
            }
          </QueryState>
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
          {selected.photos[0] && <img src={selected.photos[0].url} alt="" className="w-full h-28 rounded-lg object-cover bg-muted" />}
          <div className="flex flex-col gap-2 text-sm">
            {[
              { label: 'Cidade', value: selected.city },
              { label: 'Endereço', value: selected.address },
              { label: 'Organização', value: selected.organization.name },
              { label: 'Plano', value: selected.plan.name },
              { label: 'Gestor', value: selected.managerNames.join(', ') || '—' },
              { label: 'Membro desde', value: formatDate(selected.createdAt) },
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
            <button onClick={() => setEditing(selected)} className="w-full bg-primary text-white text-sm font-medium py-2 rounded-lg hover:bg-primary/90">
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
          notify={notify}
          onClose={() => setEditing(null)}
          onSaved={saved => {
            setEditing(null);
            setSelectedId(saved.id);
          }}
        />
      )}

      {statusChange && (
        <ConfirmDialog
          title={`${STATUS_CHANGE_COPY[statusChange.status].title} ${statusChange.establishment.name}?`}
          description={STATUS_CHANGE_COPY[statusChange.status].description}
          confirmLabel={STATUS_CHANGE_COPY[statusChange.status].title}
          tone={statusChange.status === 'active' ? 'primary' : 'danger'}
          busy={pending}
          onConfirm={() => void confirmStatusChange()}
          onClose={() => setStatusChange(null)}
        />
      )}
    </div>
  );
}

// ─── Formulário ─────────────────────────────────────────────────────────────

interface DayHours {
  open: boolean;
  opensAt: string;
  closesAt: string;
}

interface FormState {
  name: string;
  type: EstablishmentType;
  city: string;
  address: string;
  latitude: string;
  longitude: string;
  organizationId: string;
  planId: string;
  status: EstablishmentStatus;
  averageWaitMinutes: string;
  pickupPoint: string;
  foodCategories: string;
  hours: DayHours[];
}

type FormErrors = Partial<Record<'name' | 'city' | 'address' | 'coordinates' | 'organizationId' | 'planId' | 'averageWaitMinutes' | 'hours', string>>;

const DEFAULT_DAY: DayHours = { open: true, opensAt: '17:00', closesAt: '23:00' };

function toFormState(establishment: AdminEstablishmentDto | null, defaults: { organizationId: string; planId: string }): FormState {
  if (!establishment) {
    return {
      name: '',
      type: 'bar',
      city: '',
      address: '',
      latitude: '',
      longitude: '',
      organizationId: defaults.organizationId,
      planId: defaults.planId,
      status: 'active',
      averageWaitMinutes: '15',
      pickupPoint: 'Balcão',
      foodCategories: '',
      hours: WEEKDAY_LABELS.map(() => ({ ...DEFAULT_DAY })),
    };
  }
  return {
    name: establishment.name,
    type: establishment.type,
    city: establishment.city,
    address: establishment.address,
    latitude: String(establishment.latitude),
    longitude: String(establishment.longitude),
    organizationId: establishment.organization.id,
    planId: establishment.plan.id,
    status: establishment.status,
    averageWaitMinutes: String(establishment.averageWaitMinutes),
    pickupPoint: establishment.pickupPoint,
    foodCategories: establishment.foodCategories.join(', '),
    hours: WEEKDAY_LABELS.map((_, weekday) => {
      const range = establishment.openingHours.find(hour => hour.weekday === weekday);
      return range ? { open: true, opensAt: range.opensAt, closesAt: range.closesAt } : { ...DEFAULT_DAY, open: false };
    }),
  };
}

function validate(form: FormState): FormErrors {
  const errors: FormErrors = {};
  const latitude = Number(form.latitude.replace(',', '.'));
  const longitude = Number(form.longitude.replace(',', '.'));
  const wait = Number(form.averageWaitMinutes);
  if (form.name.trim().length < 2) errors.name = 'Informe o nome do estabelecimento.';
  if (form.city.trim().length < 2) errors.city = 'Informe a cidade.';
  if (form.address.trim().length < 3) errors.address = 'Informe o endereço.';
  if (!form.latitude.trim() || !form.longitude.trim() || !(Math.abs(latitude) <= 90) || !(Math.abs(longitude) <= 180)) {
    errors.coordinates = 'Informe latitude e longitude válidas (usadas na busca por proximidade).';
  }
  if (!form.organizationId) errors.organizationId = 'Selecione a organização.';
  if (!form.planId) errors.planId = 'Selecione um plano.';
  if (!Number.isInteger(wait) || wait < 0 || wait > 240) errors.averageWaitMinutes = 'Use minutos inteiros (0 a 240).';
  if (form.hours.some(day => day.open && (!day.opensAt || !day.closesAt))) errors.hours = 'Preencha abertura e fechamento dos dias abertos.';
  return errors;
}

function toInput(form: FormState): EstablishmentInput {
  return {
    name: form.name.trim(),
    type: form.type,
    city: form.city.trim(),
    address: form.address.trim(),
    latitude: Number(form.latitude.replace(',', '.')),
    longitude: Number(form.longitude.replace(',', '.')),
    organizationId: form.organizationId,
    planId: form.planId,
    status: form.status,
    averageWaitMinutes: Number(form.averageWaitMinutes),
    pickupPoint: form.pickupPoint.trim() || 'Balcão',
    foodCategories: form.foodCategories
      .split(',')
      .map(category => category.trim())
      .filter(Boolean)
      .slice(0, 10),
    openingHours: form.hours.flatMap((day, weekday) => (day.open ? [{ weekday, opensAt: day.opensAt, closesAt: day.closesAt }] : [])),
  };
}

interface FormModalProps {
  establishment: AdminEstablishmentDto | null;
  notify: (message: string) => void;
  onClose: () => void;
  onSaved: (establishment: AdminEstablishmentDto) => void;
}

function EstablishmentFormModal({ establishment, notify, onClose, onSaved }: FormModalProps) {
  const plans = usePlans();
  const organizations = useOrganizations();
  const [form, setForm] = useState<FormState>(() =>
    toFormState(establishment, { organizationId: organizations.data?.[0]?.id ?? '', planId: plans.data?.[0]?.id ?? '' }),
  );
  const [errors, setErrors] = useState<FormErrors>({});
  const [newOrganization, setNewOrganization] = useState<string | null>(null);
  const [photos, setPhotos] = useState(establishment?.photos ?? []);
  const { run, pending } = useAsyncAction(notify);

  // Listas carregam depois da abertura do modal: aplica o primeiro item como padrão no cadastro.
  const organizationId = form.organizationId || organizations.data?.[0]?.id || '';
  const planId = form.planId || plans.data?.[0]?.id || '';

  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm(prev => ({ ...prev, [key]: value }));
  const updateDay = (weekday: number, patch: Partial<DayHours>) =>
    setForm(prev => ({ ...prev, hours: prev.hours.map((day, index) => (index === weekday ? { ...day, ...patch } : day)) }));

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const current = { ...form, organizationId, planId };
    const nextErrors = validate(current);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    const saved = await run(() => saveEstablishment(toInput(current), establishment?.id), establishment ? 'Alterações salvas' : `${current.name.trim()} cadastrado`);
    if (saved) onSaved(saved);
  }

  async function addOrganization() {
    const name = newOrganization?.trim() ?? '';
    if (name.length < 2) return;
    const created = await run(() => createOrganization(name), `Organização ${name} criada`);
    if (created) {
      update('organizationId', created.id);
      setNewOrganization(null);
    }
  }

  async function handlePhoto(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !establishment) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) return notify('Use uma imagem PNG, JPG ou WEBP.');
    if (file.size > MAX_IMAGE_BYTES) return notify('A imagem deve ter no máximo 2 MB.');
    const updated = await run(() => addEstablishmentPhoto(establishment.id, file), 'Foto adicionada à galeria');
    if (updated) setPhotos(updated.photos);
  }

  async function removePhoto(photoId: string) {
    if (!establishment) return;
    const updated = await run(() => removeEstablishmentPhoto(establishment.id, photoId), 'Foto removida');
    if (updated) setPhotos(updated.photos);
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
            <select id="est-type" value={form.type} onChange={e => update('type', e.target.value as EstablishmentType)} className={PANEL_INPUT_CLASS}>
              {ESTABLISHMENT_TYPES.map(type => (
                <option key={type} value={type}>
                  {ESTABLISHMENT_TYPE_LABELS[type]}
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
            maxLength={160}
            placeholder="Rua, número · bairro"
            className={PANEL_INPUT_CLASS}
          />
        </FormField>
        <div>
          <div className="grid grid-cols-2 gap-3">
            <FormField label="Latitude" htmlFor="est-lat">
              <input id="est-lat" inputMode="decimal" value={form.latitude} onChange={e => update('latitude', e.target.value)} placeholder="-22.9056" className={PANEL_INPUT_CLASS} />
            </FormField>
            <FormField label="Longitude" htmlFor="est-lng">
              <input id="est-lng" inputMode="decimal" value={form.longitude} onChange={e => update('longitude', e.target.value)} placeholder="-47.0608" className={PANEL_INPUT_CLASS} />
            </FormField>
          </div>
          {errors.coordinates ? (
            <p className="text-error text-xs mt-1.5">{errors.coordinates}</p>
          ) : (
            <p className="text-muted-foreground text-xs mt-1.5">Coordenadas do mapa (ex.: copiadas do Google Maps). Usadas na busca por proximidade e no "Como chegar".</p>
          )}
        </div>

        <FormField label="Organização" htmlFor="est-org" error={errors.organizationId} hint="Vincula o estabelecimento à rede/grupo responsável.">
          {newOrganization === null ? (
            <select
              id="est-org"
              value={organizationId}
              onChange={e => (e.target.value === '__new__' ? setNewOrganization('') : update('organizationId', e.target.value))}
              className={PANEL_INPUT_CLASS}
            >
              {organizations.data?.map(org => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
              <option value="__new__">Nova organização…</option>
            </select>
          ) : (
            <div className="flex gap-2">
              <input
                id="est-org"
                autoFocus
                value={newOrganization}
                onChange={e => setNewOrganization(e.target.value)}
                maxLength={120}
                placeholder="Nome da organização"
                className={PANEL_INPUT_CLASS}
              />
              <button type="button" onClick={() => void addOrganization()} disabled={pending} className="px-3 rounded-xl bg-primary text-white text-sm font-medium disabled:opacity-60">
                Criar
              </button>
              <button type="button" onClick={() => setNewOrganization(null)} className="px-3 rounded-xl border border-border text-sm text-muted-foreground">
                Cancelar
              </button>
            </div>
          )}
        </FormField>

        <div className="grid grid-cols-3 gap-3">
          <FormField label="Plano" htmlFor="est-plan" error={errors.planId}>
            <select id="est-plan" value={planId} onChange={e => update('planId', e.target.value)} className={PANEL_INPUT_CLASS}>
              {plans.data?.map(plan => (
                <option key={plan.id} value={plan.id}>
                  {plan.name}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Status" htmlFor="est-status">
            <select id="est-status" value={form.status} onChange={e => update('status', e.target.value as EstablishmentStatus)} className={PANEL_INPUT_CLASS}>
              {STATUS_OPTIONS.map(option => (
                <option key={option.id} value={option.id}>
                  {option.label}
                </option>
              ))}
            </select>
          </FormField>
          <FormField label="Espera média (min)" htmlFor="est-wait" error={errors.averageWaitMinutes}>
            <input id="est-wait" type="number" min={0} max={240} value={form.averageWaitMinutes} onChange={e => update('averageWaitMinutes', e.target.value)} className={PANEL_INPUT_CLASS} />
          </FormField>
        </div>
        {form.status !== 'active' && <p className="text-xs text-muted-foreground -mt-2">Não aparece nas buscas do cliente.</p>}

        <FormField label="Local de retirada" htmlFor="est-pickup" hint="Onde o cliente busca o pedido pronto (ex.: Balcão 2).">
          <input id="est-pickup" value={form.pickupPoint} onChange={e => update('pickupPoint', e.target.value)} maxLength={60} className={PANEL_INPUT_CLASS} />
        </FormField>

        <FormField label="Categorias de comida" htmlFor="est-categories" hint="Separadas por vírgula (ex.: Bar, Petiscos).">
          <input id="est-categories" value={form.foodCategories} onChange={e => update('foodCategories', e.target.value)} maxLength={200} className={PANEL_INPUT_CLASS} />
        </FormField>

        <fieldset>
          <legend className="text-xs text-muted-foreground font-medium mb-1.5">Horário de funcionamento</legend>
          <div className="flex flex-col border border-border rounded-xl divide-y divide-border">
            {form.hours.map((day, weekday) => (
              <div key={WEEKDAY_LABELS[weekday]} className="flex items-center gap-3 px-3 py-2">
                <label className="flex items-center gap-2 w-28 text-sm text-foreground cursor-pointer">
                  <input type="checkbox" checked={day.open} onChange={e => updateDay(weekday, { open: e.target.checked })} className="w-4 h-4 accent-primary" />
                  {WEEKDAY_LABELS[weekday]}
                </label>
                {day.open ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input type="time" aria-label={`Abre ${WEEKDAY_LABELS[weekday]}`} value={day.opensAt} onChange={e => updateDay(weekday, { opensAt: e.target.value })} className="border border-border rounded-lg px-2 py-1 bg-card text-foreground" />
                    até
                    <input type="time" aria-label={`Fecha ${WEEKDAY_LABELS[weekday]}`} value={day.closesAt} onChange={e => updateDay(weekday, { closesAt: e.target.value })} className="border border-border rounded-lg px-2 py-1 bg-card text-foreground" />
                  </div>
                ) : (
                  <span className="text-xs text-muted-foreground">Fechado</span>
                )}
              </div>
            ))}
          </div>
          {errors.hours ? (
            <p className="text-error text-xs mt-1.5">{errors.hours}</p>
          ) : (
            <p className="text-muted-foreground text-xs mt-1.5">Fechamento antes da abertura significa que passa da meia-noite (ex.: 17:00 até 02:00).</p>
          )}
        </fieldset>

        {establishment && (
          <fieldset>
            <legend className="text-xs text-muted-foreground font-medium mb-1.5">Galeria de fotos</legend>
            <div className="flex gap-2 flex-wrap">
              {photos.map(photo => (
                <div key={photo.id} className="relative w-20 h-20 rounded-lg overflow-hidden bg-muted">
                  <img src={photo.url} alt="" className="w-full h-full object-cover" />
                  <button
                    type="button"
                    onClick={() => void removePhoto(photo.id)}
                    aria-label="Remover foto"
                    disabled={pending}
                    className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 text-white flex items-center justify-center"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
              <label className={cn('w-20 h-20 rounded-lg border-2 border-dashed border-border flex flex-col items-center justify-center gap-1 text-[10px] text-muted-foreground cursor-pointer hover:border-primary', pending && 'opacity-50 pointer-events-none')}>
                <ImagePlus size={16} />
                Adicionar
                <input type="file" accept={ACCEPTED_IMAGE_TYPES.join(',')} onChange={event => void handlePhoto(event)} className="sr-only" />
              </label>
            </div>
            <p className="text-muted-foreground text-xs mt-1.5">PNG, JPG ou WEBP até 2 MB. A primeira foto é a capa na busca do cliente.</p>
          </fieldset>
        )}

        <div className="flex gap-2 mt-2">
          <button type="button" onClick={onClose} className="flex-1 border border-border text-foreground py-3 rounded-xl text-sm font-medium hover:bg-muted">
            Cancelar
          </button>
          <button type="submit" disabled={pending} className="flex-1 bg-primary text-white py-3 rounded-xl text-sm font-semibold hover:bg-primary/90 disabled:opacity-60">
            {establishment ? 'Salvar alterações' : 'Cadastrar'}
          </button>
        </div>
        {isApiError(organizations.error) && <p className="text-error text-xs">Não foi possível carregar as organizações.</p>}
      </form>
    </Modal>
  );
}
