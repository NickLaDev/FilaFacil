import { useState } from 'react';
import { LogOut, ShieldAlert, Smartphone } from 'lucide-react';
import Modal from '@/components/ui/Modal';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { useAsyncAction } from '@/lib/useAsyncAction';
import { cn, formatDateTime } from '@/lib/utils';
import { revokeAllSessions, revokeSession, useAccessLogs, useUserAccess } from '@/services/sprint5Service';
import FilterChips from '../components/FilterChips';
import Pagination from '../components/Pagination';
import { Pill } from '../components/Pills';

const METHOD_LABELS: Record<string, string> = { password: 'Senha', code: 'Código', signup: 'Cadastro', google: 'Google', apple: 'Apple', passkey: 'Passkey', other: 'Outro' };

/** Ficha 52: cada login com data, IP e aparelho; aparelho novo destacado; sessões encerradas remotamente em um clique. */
export default function AccessSection({ notify }: { notify: (message: string) => void }) {
  const [page, setPage] = useState(1);
  const [filter, setFilter] = useState<'all' | 'new'>('all');
  const logs = useAccessLogs(page, filter === 'new');
  const [userId, setUserId] = useState<string | null>(null);
  const { run } = useAsyncAction(notify);

  return (
    <div className="p-6 flex flex-col gap-4 max-w-6xl">
      <FilterChips label="Filtrar acessos" value={filter} onChange={value => { setFilter(value); setPage(1); }} options={[{ id: 'all', label: 'Todos os logins' }, { id: 'new', label: 'Aparelho não reconhecido' }]} />
      {logs.error && !logs.data && <ErrorBlock error={logs.error} onRetry={() => void logs.refetch()} />}
      {!logs.data && !logs.error && <LoadingBlock />}
      {logs.data && (
        <div className="bg-card rounded-xl border border-border overflow-x-auto">
          <table className="w-full min-w-[820px]">
            <thead className="bg-muted/50"><tr className="text-left text-xs text-muted-foreground uppercase tracking-wider"><th className="px-4 py-3">Quando</th><th className="px-4 py-3">Usuário</th><th className="px-4 py-3">Aparelho</th><th className="px-4 py-3">IP</th><th className="px-4 py-3">Como</th><th className="px-4 py-3">Sessão</th></tr></thead>
            <tbody>
              {logs.data.items.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhum login registrado.</td></tr>}
              {logs.data.items.map(log => (
                <tr key={log.id} data-testid="access-row" data-new-device={log.newDevice} className={cn('border-t border-border text-sm', log.newDevice && 'bg-warning-bg/40')}>
                  <td className="px-4 py-2.5 whitespace-nowrap text-muted-foreground">{formatDateTime(log.createdAt)}</td>
                  <td className="px-4 py-2.5"><button onClick={() => setUserId(log.userId)} className="hover:underline text-foreground">{log.userName}</button></td>
                  <td className="px-4 py-2.5"><span className="inline-flex items-center gap-1.5">{log.deviceLabel}{log.newDevice && <Pill className="bg-warning/15 text-warning">Novo aparelho</Pill>}</span></td>
                  <td className="px-4 py-2.5 text-muted-foreground font-mono text-xs">{log.ipAddress ?? '—'}</td>
                  <td className="px-4 py-2.5 text-muted-foreground">{METHOD_LABELS[log.method] ?? log.method}</td>
                  <td className="px-4 py-2.5">
                    {log.sessionActive && log.sessionId ? (
                      <button onClick={() => void run(() => revokeSession(log.sessionId as string), 'Sessão encerrada: o aparelho perdeu o acesso')} data-testid="revoke-session" className="inline-flex items-center gap-1 text-xs text-error border border-error/30 rounded-lg px-2 py-1 hover:bg-error-bg"><LogOut size={12} />Encerrar</button>
                    ) : (
                      <span className="text-xs text-muted-foreground">Encerrada</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <Pagination page={page} pageSize={logs.data.pageSize} total={logs.data.total} onChange={setPage} />
        </div>
      )}
      {userId && <UserAccessModal userId={userId} notify={notify} onClose={() => setUserId(null)} />}
    </div>
  );
}

export function UserAccessModal({ userId, notify, onClose }: { userId: string; notify: (message: string) => void; onClose: () => void }) {
  const access = useUserAccess(userId);
  const { run, pending } = useAsyncAction(notify);
  const data = access.data;
  const active = data?.sessions.filter(session => session.active) ?? [];
  return (
    <Modal title={data ? `Acessos de ${data.userName}` : 'Acessos'} onClose={onClose} width="lg">
      {!data ? (
        <LoadingBlock />
      ) : (
        <div className="flex flex-col gap-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium">Sessões ativas ({active.length})</p>
              {active.length > 1 && <button disabled={pending} onClick={() => void run(() => revokeAllSessions(userId), 'Todas as sessões encerradas')} className="text-xs text-error hover:underline">Encerrar todas</button>}
            </div>
            <div className="border border-border rounded-xl divide-y divide-border">
              {active.length === 0 && <p className="px-3 py-3 text-sm text-muted-foreground">Nenhuma sessão ativa.</p>}
              {active.map(session => (
                <div key={session.id} className="px-3 py-2 flex items-center gap-3 text-sm" data-testid="user-session">
                  <Smartphone size={14} className="text-muted-foreground" />
                  <span className="flex-1">{session.deviceLabel} <span className="text-xs text-muted-foreground">· {session.ipAddress ?? 'IP desconhecido'} · último uso {formatDateTime(session.lastUsedAt)}</span></span>
                  <button disabled={pending} onClick={() => void run(() => revokeSession(session.id), 'Sessão encerrada')} className="inline-flex items-center gap-1 text-xs text-error border border-error/30 rounded-lg px-2 py-1 hover:bg-error-bg"><LogOut size={12} />Encerrar</button>
                </div>
              ))}
            </div>
          </div>
          <div>
            <p className="text-xs uppercase tracking-wider text-muted-foreground font-medium mb-2">Histórico de logins</p>
            <div className="border border-border rounded-xl divide-y divide-border max-h-72 overflow-y-auto">
              {data.logins.map(login => (
                <div key={login.id} className="px-3 py-2 flex items-center gap-3 text-sm">
                  {login.newDevice ? <ShieldAlert size={14} className="text-warning" /> : <span className="w-[14px]" />}
                  <span className="text-muted-foreground whitespace-nowrap">{formatDateTime(login.createdAt)}</span>
                  <span className="flex-1">{login.deviceLabel}</span>
                  <span className="text-xs text-muted-foreground font-mono">{login.ipAddress ?? '—'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </Modal>
  );
}
