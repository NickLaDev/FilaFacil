import { useState } from 'react';
import { History, Info, Users } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import FormField, { PANEL_INPUT_CLASS } from '@/components/ui/FormField';
import Modal from '@/components/ui/Modal';
import { PERMISSIONS, ROLE_DEFAULT_PERMISSIONS, ROLE_LABELS } from '@/data/users';
import { cn, formatDateTime } from '@/lib/utils';
import { setUserStatus, updateUserAccess, usePermissionHistory, usePlatformUsers } from '@/services/platformUserService';
import type { PlatformRole, PlatformUser } from '@/types/user';
import ConfirmDialog from '../components/ConfirmDialog';
import FilterChips, { type FilterOption } from '../components/FilterChips';
import { Pill } from '../components/Pills';
import SearchBox from '../components/SearchBox';

type View = 'users' | 'history';
type RoleFilter = 'all' | PlatformRole;

const ROLES = Object.keys(ROLE_LABELS) as PlatformRole[];

const ROLE_FILTER_LABELS: Record<RoleFilter, string> = {
  all: 'Todos',
  client: 'Clientes',
  attendant: 'Atendentes',
  manager: 'Gestores',
  admin: 'Admins',
};

const ROLE_PILL_CLASS: Record<PlatformRole, string> = {
  client: 'bg-muted text-muted-foreground',
  attendant: 'bg-blue-500/10 text-blue-500',
  manager: 'bg-primary/10 text-primary',
  admin: 'bg-secondary/10 text-secondary',
};

const USER_HEADERS = ['Nome', 'Email', 'Papel', 'Status', 'Último acesso', 'Ações'];
const HISTORY_HEADERS = ['Usuário', 'Alteração', 'Por', 'Quando'];

// Evita que o admin se tranque fora da plataforma por engano.
const SELF_LOCK_MESSAGE = 'Por segurança, você não pode suspender nem alterar o acesso da própria conta — peça a outro administrador.';

const sameAccess = (user: PlatformUser, role: PlatformRole, permissions: string[]) =>
  user.role === role && permissions.length === user.permissions.length && permissions.every(p => user.permissions.includes(p));

interface Props {
  notify: (message: string) => void;
  actorName: string;
  currentUserId: string;
}

export default function UsersSection({ notify, actorName, currentUserId }: Props) {
  const users = usePlatformUsers();
  const history = usePermissionHistory();
  const [view, setView] = useState<View>('users');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [editing, setEditing] = useState<PlatformUser | null>(null);
  const [statusTarget, setStatusTarget] = useState<PlatformUser | null>(null);

  const query = search.trim().toLowerCase();
  const filtered = users.filter(
    u => (roleFilter === 'all' || u.role === roleFilter) && (u.name.toLowerCase().includes(query) || u.email.toLowerCase().includes(query)),
  );

  const viewOptions: FilterOption<View>[] = [
    { id: 'users', label: 'Usuários', count: users.length },
    { id: 'history', label: 'Histórico de permissões', count: history.length },
  ];
  const roleOptions: FilterOption<RoleFilter>[] = (['all', ...ROLES] as RoleFilter[]).map(id => ({
    id,
    label: ROLE_FILTER_LABELS[id],
    count: id === 'all' ? users.length : users.filter(u => u.role === id).length,
  }));

  function saveAccess(user: PlatformUser, role: PlatformRole, permissions: string[]) {
    if (!sameAccess(user, role, permissions)) {
      updateUserAccess(user.id, role, permissions, actorName);
      notify(`Acesso de ${user.name} atualizado`);
    }
    setEditing(null);
  }

  function confirmStatusChange() {
    if (!statusTarget) return;
    const suspending = statusTarget.status === 'active';
    setUserStatus(statusTarget.id, suspending ? 'suspended' : 'active', actorName);
    notify(`${statusTarget.name} ${suspending ? 'suspenso' : 'reativado'}`);
    setStatusTarget(null);
  }

  return (
    <div className="p-6 flex flex-col gap-4">
      <FilterChips options={viewOptions} value={view} onChange={setView} label="Visualização" />

      {view === 'users' ? (
        <>
          <div className="flex items-center gap-3 flex-wrap">
            <SearchBox value={search} onChange={setSearch} placeholder="Buscar por nome ou email..." />
          </div>
          <FilterChips options={roleOptions} value={roleFilter} onChange={setRoleFilter} label="Filtrar por papel" />
          <div className="flex items-start gap-2 bg-muted/50 border border-border rounded-xl px-4 py-3">
            <Info size={14} className="text-muted-foreground flex-shrink-0 mt-0.5" />
            <p className="text-xs text-muted-foreground leading-relaxed">
              A suspensão derruba o acesso imediatamente, inclusive em sessões já abertas. Toda alteração de papel ou permissão fica
              registrada no histórico.
            </p>
          </div>

          <div className="bg-card border border-border rounded-xl overflow-x-auto">
            {filtered.length === 0 ? (
              <EmptyState icon={Users} title="Nenhum usuário encontrado" description="Ajuste a busca ou o filtro de papel." />
            ) : (
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
                  {filtered.map(user => {
                    const isSelf = user.id === currentUserId;
                    const isActive = user.status === 'active';
                    return (
                      <tr key={user.id} className="border-b border-border last:border-0 hover:bg-muted/10">
                        <td className="px-4 py-3 text-sm font-medium text-foreground">
                          {user.name}
                          {isSelf && <span className="ml-2 text-[10px] font-bold bg-primary/10 text-primary px-1.5 py-0.5 rounded-md">Você</span>}
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground">{user.email}</td>
                        <td className="px-4 py-3">
                          <Pill className={ROLE_PILL_CLASS[user.role]}>{ROLE_LABELS[user.role]}</Pill>
                        </td>
                        <td className="px-4 py-3">
                          <Pill className={isActive ? 'bg-success/10 text-success' : 'bg-error/10 text-error'}>
                            {isActive ? 'Ativo' : 'Suspenso'}
                          </Pill>
                        </td>
                        <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">{user.lastAccess}</td>
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
            )}
          </div>
          <p className="text-xs text-muted-foreground">{SELF_LOCK_MESSAGE}</p>
        </>
      ) : (
        <div className="bg-card border border-border rounded-xl overflow-x-auto">
          {history.length === 0 ? (
            <EmptyState icon={History} title="Nenhuma alteração registrada" />
          ) : (
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
                {history.map(change => (
                  <tr key={change.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 text-sm font-medium text-foreground whitespace-nowrap">{change.userName}</td>
                    <td className="px-4 py-3 text-sm text-foreground">{change.description}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">{change.actor}</td>
                    <td className="px-4 py-3 text-sm text-muted-foreground whitespace-nowrap">{formatDateTime(Date.parse(change.at))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {editing && <EditAccessModal user={editing} onClose={() => setEditing(null)} onSave={saveAccess} />}

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
          onConfirm={confirmStatusChange}
          onClose={() => setStatusTarget(null)}
        />
      )}
    </div>
  );
}

interface EditAccessModalProps {
  user: PlatformUser;
  onClose: () => void;
  onSave: (user: PlatformUser, role: PlatformRole, permissions: string[]) => void;
}

function EditAccessModal({ user, onClose, onSave }: EditAccessModalProps) {
  const [role, setRole] = useState<PlatformRole>(user.role);
  const [permissions, setPermissions] = useState<string[]>(user.permissions);

  function changeRole(next: PlatformRole) {
    setRole(next);
    setPermissions(ROLE_DEFAULT_PERMISSIONS[next]);
  }

  function togglePermission(id: string) {
    setPermissions(prev => (prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]));
  }

  function handleSave() {
    // Mantém a ordem do catálogo para o histórico ficar legível.
    onSave(user, role, PERMISSIONS.map(p => p.id).filter(id => permissions.includes(id)));
  }

  return (
    <Modal title={`Editar acesso · ${user.name}`} onClose={onClose} width="md">
      <div className="flex flex-col gap-4">
        <FormField label="Papel" htmlFor="user-role" hint="Trocar o papel aplica as permissões padrão dele; ajuste abaixo se precisar.">
          <select id="user-role" value={role} onChange={e => changeRole(e.target.value as PlatformRole)} className={PANEL_INPUT_CLASS}>
            {ROLES.map(option => (
              <option key={option} value={option}>
                {ROLE_LABELS[option]}
              </option>
            ))}
          </select>
        </FormField>
        <fieldset>
          <legend className="text-xs text-muted-foreground font-medium mb-1.5">Permissões</legend>
          <div className="flex flex-col border border-border rounded-xl divide-y divide-border max-h-72 overflow-y-auto">
            {PERMISSIONS.map(permission => (
              <label key={permission.id} className="flex items-center gap-3 px-4 py-2.5 cursor-pointer hover:bg-muted/40">
                <input
                  type="checkbox"
                  checked={permissions.includes(permission.id)}
                  onChange={() => togglePermission(permission.id)}
                  className="w-4 h-4 accent-primary"
                />
                <span className="text-sm text-foreground">{permission.label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 border border-border text-foreground py-3 rounded-xl text-sm font-medium hover:bg-muted">
            Cancelar
          </button>
          <button onClick={handleSave} className="flex-1 bg-primary text-white py-3 rounded-xl text-sm font-semibold hover:bg-primary/90">
            Salvar acesso
          </button>
        </div>
      </div>
    </Modal>
  );
}
