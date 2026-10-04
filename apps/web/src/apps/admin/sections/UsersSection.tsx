import { useState } from 'react';
import { History, Info, Users } from 'lucide-react';
import {
  PERMISSIONS,
  ROLE_DEFAULT_PERMISSIONS,
  ROLE_LABELS,
  STAFF_ROLES,
  USER_ROLES,
  type AdminUserDto,
  type Permission,
  type UserRole,
} from '@filafacil/shared';
import EmptyState from '@/components/ui/EmptyState';
import FormField, { PANEL_INPUT_CLASS } from '@/components/ui/FormField';
import Modal from '@/components/ui/Modal';
import { QueryState } from '@/components/ui/QueryState';
import { useDebouncedValue } from '@/lib/hooks';
import { useAsyncAction } from '@/lib/useAsyncAction';
import { cn, formatDateTime } from '@/lib/utils';
import { useAllEstablishments } from '@/services/establishmentService';
import { setUserStatus, updateUserAccess, usePermissionHistory, usePlatformUsers } from '@/services/platformUserService';
import ConfirmDialog from '../components/ConfirmDialog';
import FilterChips, { type FilterOption } from '../components/FilterChips';
import Pagination from '../components/Pagination';
import { Pill } from '../components/Pills';
import SearchBox from '../components/SearchBox';

type View = 'users' | 'history';
type RoleFilter = 'all' | UserRole;

const PAGE_SIZE = 20;

const ROLE_FILTER_LABELS: Record<RoleFilter, string> = {
  all: 'Todos',
  client: 'Clientes',
  attendant: 'Atendentes',
  manager: 'Gestores',
  admin: 'Admins',
};

const ROLE_PILL_CLASS: Record<UserRole, string> = {
  client: 'bg-muted text-muted-foreground',
  attendant: 'bg-blue-500/10 text-blue-500',
  manager: 'bg-primary/10 text-primary',
  admin: 'bg-secondary/10 text-secondary',
};

/** Permissões que fazem sentido para cada papel (o servidor aplica a mesma regra). */
const ROLE_SCOPE: Record<UserRole, (typeof PERMISSIONS)[number]['scope']> = {
  client: 'client',
  attendant: 'establishment',
  manager: 'establishment',
  admin: 'platform',
};

const USER_HEADERS = ['Nome', 'Email', 'Papel', 'Status', 'Último acesso', 'Ações'];
const HISTORY_HEADERS = ['Usuário', 'Alteração', 'Por', 'Quando'];

// Evita que o admin se tranque fora da plataforma por engano (o servidor também bloqueia).
const SELF_LOCK_MESSAGE = 'Por segurança, você não pode suspender nem alterar o acesso da própria conta — peça a outro administrador.';

interface Props {
  notify: (message: string) => void;
  currentUserId: string;
}

/** Ficha 36: usuários por papel, permissões, suspensão e histórico de alterações. */
export default function UsersSection({ notify, currentUserId }: Props) {
  const [view, setView] = useState<View>('users');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [page, setPage] = useState(1);
  const [historyPage, setHistoryPage] = useState(1);
  const users = usePlatformUsers({ q: useDebouncedValue(search.trim()), role: roleFilter, page, pageSize: PAGE_SIZE });
  const history = usePermissionHistory(historyPage, PAGE_SIZE);
  const [editing, setEditing] = useState<AdminUserDto | null>(null);
  const [statusTarget, setStatusTarget] = useState<AdminUserDto | null>(null);
  const { run, pending } = useAsyncAction(notify);

  const counts = users.data?.counts;
  const viewOptions: FilterOption<View>[] = [
    { id: 'users', label: 'Usuários', count: counts?.all },
    { id: 'history', label: 'Histórico de permissões', count: history.data?.total },
  ];
  const roleOptions: FilterOption<RoleFilter>[] = (['all', ...USER_ROLES] as RoleFilter[]).map(id => ({
    id,
    label: ROLE_FILTER_LABELS[id],
    count: counts?.[id],
  }));

  async function confirmStatusChange() {
    if (!statusTarget) return;
    const suspending = statusTarget.status === 'active';
    await run(() => setUserStatus(statusTarget.id, suspending ? 'suspended' : 'active'), `${statusTarget.name} ${suspending ? 'suspenso' : 'reativado'}`);
    setStatusTarget(null);
  }

  return (
    <div className="p-6 flex flex-col gap-4">
      <FilterChips options={viewOptions} value={view} onChange={setView} label="Visualização" />

      {view === 'users' ? (
        <>
          <div className="flex items-center gap-3 flex-wrap">
            <SearchBox
              value={search}
              onChange={value => {
                setSearch(value);
                setPage(1);
              }}
              placeholder="Buscar por nome ou email..."
            />
          </div>
          <FilterChips
            options={roleOptions}
            value={roleFilter}
            onChange={value => {
              setRoleFilter(value);
              setPage(1);
            }}
            label="Filtrar por papel"
          />
          <div className="flex items-start gap-2 bg-muted/50 border border-border rounded-xl px-4 py-3">
            <Info size={14} className="text-muted-foreground flex-shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              A suspensão derruba o acesso imediatamente, inclusive em sessões já abertas. Toda alteração de papel ou permissão fica
              registrada no histórico.
            </p>
          </div>

          <div className="bg-card border border-border rounded-xl overflow-x-auto">
            <QueryState query={users}>
              {data =>
                data.items.length === 0 ? (
                  <EmptyState icon={Users} title="Nenhum usuário encontrado" description="Ajuste a busca ou o filtro de papel." />
                ) : (
                  <>
                    <table className="w-full min-w-[760px]">
                      <thead>
                        <tr className="border-b border-border bg-muted/30">
                          {USER_HEADERS.map(header => (
                            <th key={header} className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">
                              {header}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.items.map(user => {
                          const isSelf = user.id === currentUserId;
                          const isActive = user.status === 'active';
                          return (
                            <tr key={user.id} className="border-b border-border last:border-0 hover:bg-muted/10">
                              <td className="px-4 py-3 text-sm font-medium text-foreground">
                                {user.name}
                                {isSelf && <span className="ml-2 text-[10px] font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded-md">Você</span>}
                                {user.memberships.length > 0 && (
                                  <p className="text-[11px] text-muted-foreground font-normal">{user.memberships.map(m => m.establishmentName).join(', ')}</p>
                                )}
                              </td>
                              <td className="px-4 py-3 text-sm text-muted-foreground">{user.email ?? user.phone ?? '—'}</td>
                              <td className="px-4 py-3">
                                <Pill className={ROLE_PILL_CLASS[user.role]}>{ROLE_LABELS[user.role]}</Pill>
                              </td>
                              <td className="px-4 py-3">
                                <Pill className={isActive ? 'bg-success/10 text-success' : 'bg-error/10 text-error'}>{isActive ? 'Ativo' : 'Suspenso'}</Pill>
                              </td>
                              <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">
                                {user.lastAccessAt ? formatDateTime(user.lastAccessAt) : 'Nunca'}
                              </td>
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-1.5 whitespace-nowrap">
                                  <button
                                    onClick={() => setEditing(user)}
                                    disabled={isSelf}
                                    title={isSelf ? SELF_LOCK_MESSAGE : undefined}
                                    className="text-xs text-primary font-medium hover:underline disabled:text-muted-foreground disabled:no-underline disabled:cursor-not-allowed"
                                  >
                                    Editar acesso
                                  </button>
                                  <span className="text-border">·</span>
                                  <button
                                    onClick={() => setStatusTarget(user)}
                                    disabled={isSelf}
                                    title={isSelf ? SELF_LOCK_MESSAGE : undefined}
                                    className={cn(
                                      'text-xs font-medium hover:underline disabled:text-muted-foreground disabled:no-underline disabled:cursor-not-allowed',
                                      isActive ? 'text-error' : 'text-success',
                                    )}
                                  >
                                    {isActive ? 'Suspender' : 'Reativar'}
                                  </button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                    <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setPage} />
                  </>
                )
              }
            </QueryState>
          </div>
          <p className="text-xs text-muted-foreground">{SELF_LOCK_MESSAGE}</p>
        </>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-x-auto">
          <QueryState query={history}>
            {data =>
              data.items.length === 0 ? (
                <EmptyState icon={History} title="Nenhuma alteração registrada" />
              ) : (
                <>
                  <table className="w-full min-w-[640px]">
                    <thead>
                      <tr className="border-b border-border bg-muted/30">
                        {HISTORY_HEADERS.map(header => (
                          <th key={header} className="text-left text-xs font-semibold text-muted-foreground px-4 py-3">
                            {header}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {data.items.map(change => (
                        <tr key={change.id} className="border-b border-border last:border-0">
                          <td className="px-4 py-3 text-sm font-medium text-foreground whitespace-nowrap">{change.targetUserName}</td>
                          <td className="px-4 py-3 text-sm text-foreground">{change.description}</td>
                          <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">{change.actorName}</td>
                          <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">{formatDateTime(change.createdAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <Pagination page={data.page} pageSize={data.pageSize} total={data.total} onChange={setHistoryPage} />
                </>
              )
            }
          </QueryState>
        </div>
      )}

      {editing && <EditAccessModal user={editing} notify={notify} onClose={() => setEditing(null)} />}

      {statusTarget && (
        <ConfirmDialog
          title={statusTarget.status === 'active' ? `Suspender ${statusTarget.name}?` : `Reativar ${statusTarget.name}?`}
          description={
            statusTarget.status === 'active'
              ? 'O usuário perde o acesso ao sistema na hora, inclusive em sessões já abertas.'
              : 'O acesso do usuário volta a ser liberado com o papel e as permissões atuais.'
          }
          confirmLabel={statusTarget.status === 'active' ? 'Suspender' : 'Reativar'}
          tone={statusTarget.status === 'active' ? 'danger' : 'primary'}
          busy={pending}
          onConfirm={() => void confirmStatusChange()}
          onClose={() => setStatusTarget(null)}
        />
      )}
    </div>
  );
}

interface EditAccessModalProps {
  user: AdminUserDto;
  notify: (message: string) => void;
  onClose: () => void;
}

function EditAccessModal({ user, notify, onClose }: EditAccessModalProps) {
  const establishments = useAllEstablishments();
  const [role, setRole] = useState<UserRole>(user.role);
  const [permissions, setPermissions] = useState<Permission[]>(user.permissions);
  const [establishmentIds, setEstablishmentIds] = useState<string[]>(user.memberships.map(m => m.establishmentId));
  const [error, setError] = useState('');
  const { run, pending } = useAsyncAction(notify);

  const isStaff = STAFF_ROLES.includes(role);
  const available = PERMISSIONS.filter(permission => permission.scope === ROLE_SCOPE[role]);

  function changeRole(next: UserRole) {
    setRole(next);
    setPermissions(ROLE_DEFAULT_PERMISSIONS[next]);
  }

  const toggle = <T,>(list: T[], value: T) => (list.includes(value) ? list.filter(item => item !== value) : [...list, value]);

  async function handleSave() {
    if (isStaff && establishmentIds.length === 0) return setError('Vincule atendentes e gestores a pelo menos um estabelecimento.');
    // Mantém a ordem do catálogo para o histórico ficar legível.
    const ordered = PERMISSIONS.map(p => p.key).filter(key => permissions.includes(key));
    const saved = await run(() => updateUserAccess(user.id, role, ordered, isStaff ? establishmentIds : []), `Acesso de ${user.name} atualizado`);
    if (saved) onClose();
  }

  return (
    <Modal title={`Editar acesso · ${user.name}`} onClose={onClose} width="md">
      <div className="flex flex-col gap-4">
        <FormField label="Papel" htmlFor="user-role" hint="Trocar o papel aplica as permissões padrão dele; ajuste abaixo se precisar.">
          <select id="user-role" value={role} onChange={e => changeRole(e.target.value as UserRole)} className={PANEL_INPUT_CLASS}>
            {USER_ROLES.map(option => (
              <option key={option} value={option}>
                {ROLE_LABELS[option]}
              </option>
            ))}
          </select>
        </FormField>
        <fieldset>
          <legend className="text-xs text-muted-foreground font-medium mb-1.5">Permissões</legend>
          <div className="flex flex-col border border-border rounded-xl divide-y divide-border max-h-60 overflow-y-auto">
            {available.map(permission => (
              <label key={permission.key} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-muted/40">
                <input
                  type="checkbox"
                  checked={permissions.includes(permission.key)}
                  onChange={() => setPermissions(prev => toggle(prev, permission.key))}
                  className="w-4 h-4 accent-primary"
                />
                <span className="text-sm text-foreground">{permission.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        {isStaff && (
          <fieldset>
            <legend className="text-xs text-muted-foreground font-medium mb-1.5">Estabelecimentos em que trabalha</legend>
            <div className="flex flex-col border border-border rounded-xl divide-y divide-border max-h-48 overflow-y-auto">
              {establishments.data?.map(establishment => (
                <label key={establishment.id} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-muted/40">
                  <input
                    type="checkbox"
                    checked={establishmentIds.includes(establishment.id)}
                    onChange={() => {
                      setEstablishmentIds(prev => toggle(prev, establishment.id));
                      setError('');
                    }}
                    className="w-4 h-4 accent-primary"
                  />
                  <span className="text-sm text-foreground">{establishment.name}</span>
                  <span className="text-[11px] text-muted-foreground ml-auto">{establishment.organization.name}</span>
                </label>
              ))}
            </div>
            {error && <p className="text-error text-xs mt-1.5">{error}</p>}
          </fieldset>
        )}
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 border border-border text-foreground py-3 rounded-xl text-sm font-medium hover:bg-muted">
            Cancelar
          </button>
          <button onClick={() => void handleSave()} disabled={pending} className="flex-1 bg-primary text-white py-3 rounded-xl text-sm font-semibold hover:bg-primary/90 disabled:opacity-60">
            Salvar acesso
          </button>
        </div>
      </div>
    </Modal>
  );
}
