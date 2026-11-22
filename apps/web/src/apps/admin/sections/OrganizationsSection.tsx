import { useState } from 'react';
import { ExternalLink, Network, Plus, Trash2, UserPlus } from 'lucide-react';
import { ORGANIZATION_ROLE_LABELS, type OrganizationRole } from '@filafacil/shared';
import { PANEL_INPUT_CLASS } from '@/components/ui/FormField';
import Modal from '@/components/ui/Modal';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { addDays, isoDay } from '@/lib/dates';
import { useDebouncedValue } from '@/lib/hooks';
import { useAsyncAction } from '@/lib/useAsyncAction';
import { cn, formatCents } from '@/lib/utils';
import { createOrganization, useAllEstablishments } from '@/services/establishmentService';
import { usePlatformUsers } from '@/services/platformUserService';
import { linkEstablishment, removeOrganizationMember, setOrganizationMember, useOrganizationDetail, useOrganizationsOverview } from '@/services/sprint5Service';
import { EstablishmentStatusPill, PlanPill } from '../components/Pills';

interface Props {
  notify: (message: string) => void;
  onOpenEstablishment: (name: string) => void;
}

/** Ficha 35: redes com várias unidades, hierarquia de acesso por rede e relatório consolidado. */
export default function OrganizationsSection({ notify, onOpenEstablishment }: Props) {
  const list = useOrganizationsOverview();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const { run } = useAsyncAction(notify);
  const [newName, setNewName] = useState('');

  if (list.error && !list.data) return <ErrorBlock error={list.error} onRetry={() => void list.refetch()} />;
  if (!list.data) return <LoadingBlock />;
  const activeId = selectedId ?? list.data[0]?.id ?? null;

  return (
    <div className="p-6 flex gap-6 items-start flex-col lg:flex-row">
      <aside className="w-full lg:w-72 flex flex-col gap-2 flex-shrink-0">
        <button onClick={() => setCreating(true)} className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-xl text-sm font-medium"><Plus size={15} />Nova organização</button>
        {list.data.map(org => (
          <button key={org.id} data-testid="organization-item" onClick={() => setSelectedId(org.id)} className={cn('text-left border rounded-xl px-4 py-3', org.id === activeId ? 'border-primary bg-primary/5' : 'border-border bg-card hover:bg-muted')}>
            <p className="font-medium text-sm text-foreground flex items-center gap-2"><Network size={14} />{org.name}</p>
            <p className="text-xs text-muted-foreground mt-0.5">{org.units} unidade(s) · {org.activeUnits} ativa(s) · {org.members} na rede</p>
          </button>
        ))}
      </aside>
      <div className="flex-1 min-w-0 w-full">{activeId ? <OrganizationDetail id={activeId} notify={notify} onOpenEstablishment={onOpenEstablishment} /> : <p className="text-sm text-muted-foreground">Nenhuma organização cadastrada.</p>}</div>
      {creating && (
        <Modal title="Nova organização" onClose={() => setCreating(false)}>
          <form
            className="flex flex-col gap-3"
            onSubmit={event => {
              event.preventDefault();
              if (newName.trim().length < 2) return;
              void run(() => createOrganization(newName.trim()), 'Organização criada').then(created => {
                if (!created) return;
                void list.refetch();
                setSelectedId(created.id);
                setCreating(false);
                setNewName('');
              });
            }}
          >
            <input aria-label="Nome da organização" value={newName} onChange={event => setNewName(event.target.value)} maxLength={80} className={PANEL_INPUT_CLASS} placeholder="Ex.: Grupo Boteco" />
            <button type="submit" className="bg-primary text-primary-foreground rounded-xl py-2.5 text-sm font-semibold">Criar</button>
          </form>
        </Modal>
      )}
    </div>
  );
}

function OrganizationDetail({ id, notify, onOpenEstablishment }: { id: string; notify: (message: string) => void; onOpenEstablishment: (name: string) => void }) {
  const today = isoDay(new Date());
  const [from, setFrom] = useState(addDays(today, -29));
  const [to, setTo] = useState(today);
  const detail = useOrganizationDetail(id, from, to);
  const establishments = useAllEstablishments().data ?? [];
  const { run, pending } = useAsyncAction(notify);
  const [linking, setLinking] = useState('');
  const [addingMember, setAddingMember] = useState(false);

  if (detail.error && !detail.data) return <ErrorBlock error={detail.error} onRetry={() => void detail.refetch()} />;
  if (!detail.data) return <LoadingBlock />;
  const org = detail.data;
  const outside = establishments.filter(establishment => !org.establishments.some(unit => unit.id === establishment.id));

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-end gap-3 flex-wrap">
        <h2 className="font-display text-lg font-bold text-foreground mr-auto">{org.name}</h2>
        <div>
          <label htmlFor="org-from" className="text-xs text-muted-foreground font-medium block mb-1">De</label>
          <input id="org-from" type="date" value={from} onChange={event => setFrom(event.target.value)} className="border border-border rounded-xl px-3 py-2 text-sm bg-card" />
        </div>
        <div>
          <label htmlFor="org-to" className="text-xs text-muted-foreground font-medium block mb-1">Até</label>
          <input id="org-to" type="date" value={to} onChange={event => setTo(event.target.value)} className="border border-border rounded-xl px-3 py-2 text-sm bg-card" />
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3" data-testid="org-totals">
        <div className="bg-card border border-border rounded-xl p-4"><p className="text-xs uppercase tracking-wider text-muted-foreground">Pedidos</p><p className="font-display text-2xl font-bold">{org.report.totals.orders}</p></div>
        <div className="bg-card border border-border rounded-xl p-4"><p className="text-xs uppercase tracking-wider text-muted-foreground">GMV consolidado</p><p className="font-display text-2xl font-bold" data-testid="org-gmv">{formatCents(org.report.totals.gmvCents)}</p></div>
        <div className="bg-card border border-border rounded-xl p-4"><p className="text-xs uppercase tracking-wider text-muted-foreground">Ticket médio</p><p className="font-display text-2xl font-bold">{formatCents(org.report.totals.averageTicketCents)}</p></div>
      </div>

      <div className="bg-card rounded-xl border border-border overflow-x-auto">
        <table className="w-full min-w-[560px]">
          <thead className="bg-muted/50"><tr className="text-left text-xs text-muted-foreground uppercase tracking-wider"><th className="px-4 py-3">Unidade</th><th className="px-4 py-3 text-right">Pedidos</th><th className="px-4 py-3 text-right">GMV</th><th className="px-4 py-3 text-right">Ticket médio</th><th className="px-4 py-3" /></tr></thead>
          <tbody>
            {org.report.units.map(unit => (
              <tr key={unit.id} data-testid="org-unit" className="border-t border-border text-sm">
                <td className="px-4 py-2.5"><span className="font-medium">{unit.name}</span> <PlanPill name={unit.planName} /> <EstablishmentStatusPill status={unit.status} /></td>
                <td className="px-4 py-2.5 text-right tabular-nums">{unit.orders}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatCents(unit.gmvCents)}</td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatCents(unit.averageTicketCents)}</td>
                <td className="px-4 py-2.5 text-right"><button onClick={() => onOpenEstablishment(unit.name)} className="inline-flex items-center gap-1 text-xs text-primary hover:underline"><ExternalLink size={12} />Abrir</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex items-center gap-2">
        <select aria-label="Vincular estabelecimento" value={linking} onChange={event => setLinking(event.target.value)} className={cn(PANEL_INPUT_CLASS, 'max-w-xs')}>
          <option value="">Vincular outro estabelecimento…</option>
          {outside.map(establishment => <option key={establishment.id} value={establishment.id}>{establishment.name}</option>)}
        </select>
        <button disabled={!linking || pending} onClick={() => void run(() => linkEstablishment(id, linking), 'Estabelecimento vinculado à rede').then(() => setLinking(''))} className="border border-border rounded-xl px-4 py-2 text-sm hover:bg-muted disabled:opacity-50">Vincular</button>
      </div>

      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Pessoas da rede</p>
          <button onClick={() => setAddingMember(true)} className="flex items-center gap-1 text-sm text-primary"><UserPlus size={14} />Adicionar</button>
        </div>
        <div className="bg-card rounded-xl border border-border divide-y divide-border">
          {org.members.length === 0 && <p className="px-4 py-5 text-sm text-center text-muted-foreground">Ninguém com papel na rede. Admins da rede acessam todas as unidades; visualizadores só o relatório consolidado.</p>}
          {org.members.map(member => (
            <div key={member.userId} data-testid="org-member" className="px-4 py-2.5 flex items-center gap-3 text-sm">
              <span className="flex-1 min-w-0 truncate">{member.name} <span className="text-xs text-muted-foreground">· {member.email ?? member.userRole}</span></span>
              <select aria-label={`Papel de ${member.name}`} value={member.role} onChange={event => void run(() => setOrganizationMember(id, member.userId, event.target.value as OrganizationRole), 'Papel atualizado')} className="border border-border rounded-lg px-2 py-1 text-xs bg-card">
                {(Object.keys(ORGANIZATION_ROLE_LABELS) as OrganizationRole[]).map(role => <option key={role} value={role}>{ORGANIZATION_ROLE_LABELS[role]}</option>)}
              </select>
              <button onClick={() => void run(() => removeOrganizationMember(id, member.userId), 'Removido da rede')} aria-label={`Remover ${member.name} da rede`} className="p-1.5 hover:bg-error-bg rounded-lg text-muted-foreground hover:text-error"><Trash2 size={14} /></button>
            </div>
          ))}
        </div>
      </div>
      {addingMember && <AddMemberModal organizationId={id} notify={notify} onClose={() => setAddingMember(false)} />}
    </div>
  );
}

function AddMemberModal({ organizationId, notify, onClose }: { organizationId: string; notify: (message: string) => void; onClose: () => void }) {
  const [search, setSearch] = useState('');
  const [role, setRole] = useState<OrganizationRole>('viewer');
  const users = usePlatformUsers({ q: useDebouncedValue(search.trim()), role: 'all', page: 1, pageSize: 8 }).data?.items.filter(user => user.role !== 'client') ?? [];
  const { run, pending } = useAsyncAction(notify);
  return (
    <Modal title="Adicionar à rede" onClose={onClose} width="md">
      <div className="flex flex-col gap-3">
        <select aria-label="Papel na rede" value={role} onChange={event => setRole(event.target.value as OrganizationRole)} className={PANEL_INPUT_CLASS}>
          {(Object.keys(ORGANIZATION_ROLE_LABELS) as OrganizationRole[]).map(option => <option key={option} value={option}>{ORGANIZATION_ROLE_LABELS[option]}</option>)}
        </select>
        <input aria-label="Buscar pessoa da equipe" value={search} onChange={event => setSearch(event.target.value)} placeholder="Buscar por nome ou e-mail…" className={PANEL_INPUT_CLASS} />
        <div className="flex flex-col divide-y divide-border border border-border rounded-xl max-h-64 overflow-y-auto">
          {users.length === 0 && <p className="px-3 py-4 text-sm text-center text-muted-foreground">Nenhuma pessoa da equipe encontrada.</p>}
          {users.map(user => (
            <button key={user.id} disabled={pending} onClick={() => void run(() => setOrganizationMember(organizationId, user.id, role), `${user.name} adicionado à rede`).then(result => result && onClose())} className="text-left px-3 py-2 text-sm hover:bg-muted">
              {user.name} <span className="text-xs text-muted-foreground">· {user.email} · {user.role}</span>
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
