import { useState } from 'react';
import { History } from 'lucide-react';
import { ESTABLISHMENT_FIELD_LABELS, type EstablishmentChangeDto } from '@filafacil/shared';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { useAllEstablishments } from '@/services/establishmentService';
import { cn, formatDateTime } from '@/lib/utils';
import { useEstablishmentChanges } from '@/services/sprint4StaffService';
import Pagination from '../components/Pagination';
import SearchBox from '../components/SearchBox';

const FIELDS = Object.entries(ESTABLISHMENT_FIELD_LABELS);

/** Mostra um valor do histórico de forma legível (texto, lista, horário de funcionamento ou objeto). */
function formatChangeValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'boolean') return value ? 'Sim' : 'Não';
  if (Array.isArray(value)) {
    if (value.length === 0) return '(vazio)';
    if (value.every(item => item && typeof item === 'object' && 'weekday' in item)) {
      const days = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
      return value.map(item => { const range = item as { weekday: number; opensAt: string; closesAt: string }; return `${days[range.weekday]} ${range.opensAt}–${range.closesAt}`; }).join(' · ');
    }
    return value.map(String).join(', ');
  }
  if (typeof value === 'object') return Object.entries(value as Record<string, unknown>).map(([key, item]) => `${key}: ${String(item)}`).join(' · ');
  return String(value);
}

/** Ficha 66: quem mudou o quê e quando no cadastro dos estabelecimentos, com o valor antes e depois. Somente leitura. */
export default function HistorySection() {
  const establishments = useAllEstablishments().data ?? [];
  const [establishmentId, setEstablishmentId] = useState('');
  const [field, setField] = useState('');
  const [q, setQ] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [open, setOpen] = useState<string | null>(null);
  const query = useEstablishmentChanges({ establishmentId: establishmentId || undefined, field: field || undefined, q: q.trim() || undefined, from: from || undefined, to: to || undefined, page });
  const reset = <T,>(set: (value: T) => void) => (value: T) => { set(value); setPage(1); };

  return (
    <div className="p-6 flex flex-col gap-4 max-w-6xl">
      <div className="flex items-end gap-3 flex-wrap">
        <select aria-label="Estabelecimento" value={establishmentId} onChange={event => reset(setEstablishmentId)(event.target.value)} className="border border-border rounded-xl px-3 py-2 text-sm bg-card">
          <option value="">Todos os estabelecimentos</option>
          {establishments.map(establishment => <option key={establishment.id} value={establishment.id}>{establishment.name}</option>)}
        </select>
        <select aria-label="Campo alterado" value={field} onChange={event => reset(setField)(event.target.value)} className="border border-border rounded-xl px-3 py-2 text-sm bg-card">
          <option value="">Qualquer campo</option>
          {FIELDS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select>
        <div><label htmlFor="history-from" className="text-xs text-muted-foreground block mb-1">De</label><input id="history-from" type="date" value={from} onChange={event => reset(setFrom)(event.target.value)} className="border border-border rounded-xl px-3 py-2 text-sm bg-card" /></div>
        <div><label htmlFor="history-to" className="text-xs text-muted-foreground block mb-1">Até</label><input id="history-to" type="date" value={to} onChange={event => reset(setTo)(event.target.value)} className="border border-border rounded-xl px-3 py-2 text-sm bg-card" /></div>
        <SearchBox value={q} onChange={reset(setQ)} placeholder="Buscar por autor ou estabelecimento" />
      </div>
      <p className="text-xs text-muted-foreground">Registro permanente: não pode ser editado nem apagado. Toque em uma linha para comparar o valor antes e depois.</p>

      {query.error && !query.data ? (
        <ErrorBlock error={query.error} onRetry={() => void query.refetch()} />
      ) : !query.data ? (
        <LoadingBlock />
      ) : (
        <div className="bg-card rounded-xl border border-border overflow-x-auto">
          <table className="w-full min-w-[720px]">
            <thead className="bg-muted/50"><tr className="text-left text-xs text-muted-foreground uppercase tracking-wider"><th className="px-4 py-3">Data</th><th className="px-4 py-3">Autor</th><th className="px-4 py-3">Estabelecimento</th><th className="px-4 py-3">Campo</th></tr></thead>
            <tbody>
              {query.data.items.length === 0 && <tr><td colSpan={4} className="px-4 py-10 text-center text-sm text-muted-foreground"><History size={16} className="inline mr-2" />Nenhuma alteração registrada.</td></tr>}
              {query.data.items.map((change: EstablishmentChangeDto) => (
                <ChangeRow key={change.id} change={change} open={open === change.id} onToggle={() => setOpen(open === change.id ? null : change.id)} />
              ))}
            </tbody>
          </table>
          <Pagination page={page} pageSize={query.data.pageSize} total={query.data.total} onChange={setPage} />
        </div>
      )}
    </div>
  );
}

function ChangeRow({ change, open, onToggle }: { change: EstablishmentChangeDto; open: boolean; onToggle: () => void }) {
  return (
    <>
      <tr data-testid="change-row" data-field={change.field} onClick={onToggle} className="border-t border-border text-sm cursor-pointer hover:bg-muted/30">
        <td className="px-4 py-3 whitespace-nowrap">{formatDateTime(change.createdAt)}</td>
        <td className="px-4 py-3 text-foreground">{change.actorName}</td>
        <td className="px-4 py-3 text-muted-foreground">{change.establishmentName}</td>
        <td className="px-4 py-3 font-medium text-foreground">{change.fieldLabel}</td>
      </tr>
      {open && (
        <tr data-testid="change-compare" className="bg-muted/30">
          <td colSpan={4} className="px-4 py-3">
            <div className="grid gap-3 md:grid-cols-2 text-sm">
              <div className={cn('rounded-lg border border-error/20 bg-error-bg/40 px-3 py-2')}><p className="text-[11px] uppercase tracking-wider text-error font-bold mb-1">Antes</p><p data-testid="change-old" className="text-foreground break-words">{formatChangeValue(change.oldValue)}</p></div>
              <div className="rounded-lg border border-success/20 bg-success-bg/40 px-3 py-2"><p className="text-[11px] uppercase tracking-wider text-success font-bold mb-1">Depois</p><p data-testid="change-new" className="text-foreground break-words">{formatChangeValue(change.newValue)}</p></div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
