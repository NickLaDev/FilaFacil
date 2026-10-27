import { useState } from 'react';
import { ChefHat, Printer, Trash2 } from 'lucide-react';
import EmptyState from '@/components/ui/EmptyState';
import { PANEL_INPUT_CLASS } from '@/components/ui/FormField';
import { ErrorBlock, LoadingBlock } from '@/components/ui/QueryState';
import { useAsyncAction } from '@/lib/useAsyncAction';
import { cn, formatDateTime } from '@/lib/utils';
import { createPrinter, createStation, deletePrinter, deleteStation, renameStation, sendPrinterHeartbeat, usePrinters, useStations } from '@/services/operationsService';
import type { ManagerSectionProps } from '../../types';
import ConfirmDialog from '../../components/ConfirmDialog';

/** Fichas 24 e 26: estações da cozinha e impressoras (heartbeat simulado; nenhum hardware real é testado). */
export default function KitchenSection({ unit, notify }: ManagerSectionProps) {
  const stations = useStations(unit.id);
  const printers = usePrinters(unit.id);
  const { run, pending } = useAsyncAction(notify);
  const [stationName, setStationName] = useState('');
  const [printerName, setPrinterName] = useState('');
  const [printerStation, setPrinterStation] = useState('');
  const [deleting, setDeleting] = useState<{ id: string; name: string } | null>(null);
  const [lastKey, setLastKey] = useState<{ name: string; key: string } | null>(null);

  const failed = stations.error ?? printers.error;
  if (failed && (!stations.data || !printers.data)) return <ErrorBlock error={failed} onRetry={() => void Promise.all([stations.refetch(), printers.refetch()])} />;
  if (!stations.data || !printers.data) return <LoadingBlock />;

  return (
    <div className="p-6 grid gap-6 xl:grid-cols-2 max-w-6xl">
      <section aria-label="Estações" className="flex flex-col gap-3">
        <h2 className="font-display font-bold text-foreground flex items-center gap-2"><ChefHat size={16} />Estações da cozinha</h2>
        <p className="text-xs text-muted-foreground">Itens sem estação pertencem à estação implícita “Geral”. Defina a estação de cada item no cardápio.</p>
        <form
          className="flex gap-2"
          onSubmit={e => {
            e.preventDefault();
            void run(async () => { await createStation(unit.id, stationName.trim()); setStationName(''); }, 'Estação criada');
          }}
        >
          <input aria-label="Nome da estação" placeholder="Ex.: Chapa, Bar" maxLength={40} value={stationName} onChange={e => setStationName(e.target.value)} className={PANEL_INPUT_CLASS} />
          <button type="submit" disabled={pending || !stationName.trim()} className="bg-primary text-primary-foreground text-sm font-medium rounded-xl px-4 disabled:opacity-50">Adicionar</button>
        </form>
        {stations.data.length === 0 ? (
          <div className="bg-card border border-border rounded-xl"><EmptyState icon={ChefHat} title="Nenhuma estação" description="Cadastre estações para separar o preparo (ex.: Chapa e Bar)." /></div>
        ) : (
          <ul className="bg-card border border-border rounded-xl divide-y divide-border">
            {stations.data.map(station => (
              <StationRow key={station.id} id={station.id} name={station.name} itemCount={station.itemCount} pending={pending}
                onRename={name => void run(() => renameStation(unit.id, station.id, name), 'Estação renomeada')}
                onDelete={() => setDeleting({ id: station.id, name: station.name })} />
            ))}
          </ul>
        )}
      </section>

      <section aria-label="Impressoras" className="flex flex-col gap-3">
        <h2 className="font-display font-bold text-foreground flex items-center gap-2"><Printer size={16} />Impressoras</h2>
        <p className="text-xs text-muted-foreground">Sem sinal por 60 s a impressora fica offline e a equipe recebe um alerta no painel. O botão “Enviar sinal” simula o dispositivo.</p>
        <form
          className="flex gap-2 flex-wrap"
          onSubmit={e => {
            e.preventDefault();
            void run(async () => {
              const created = await createPrinter(unit.id, { name: printerName.trim(), stationId: printerStation || null });
              setLastKey({ name: created.name, key: created.deviceKey });
              setPrinterName('');
            }, 'Impressora cadastrada');
          }}
        >
          <input aria-label="Nome da impressora" placeholder="Nome da impressora" maxLength={40} value={printerName} onChange={e => setPrinterName(e.target.value)} className={cn(PANEL_INPUT_CLASS, 'flex-1 min-w-40')} />
          <select aria-label="Estação da impressora" value={printerStation} onChange={e => setPrinterStation(e.target.value)} className={cn(PANEL_INPUT_CLASS, 'w-auto')}>
            <option value="">Sem estação</option>
            {stations.data.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <button type="submit" disabled={pending || !printerName.trim()} className="bg-primary text-primary-foreground text-sm font-medium rounded-xl px-4 disabled:opacity-50">Cadastrar</button>
        </form>
        {lastKey && (
          <p role="status" className="text-xs bg-muted rounded-lg px-3 py-2 break-all">
            Chave do dispositivo “{lastKey.name}” (aparece só agora): <code data-testid="device-key">{lastKey.key}</code>
          </p>
        )}
        {printers.data.length === 0 ? (
          <div className="bg-card border border-border rounded-xl"><EmptyState icon={Printer} title="Nenhuma impressora" description="Cadastre uma impressora para acompanhar o sinal dela." /></div>
        ) : (
          <ul className="bg-card border border-border rounded-xl divide-y divide-border">
            {printers.data.map(printer => (
              <li key={printer.id} data-testid="printer-row" className="px-4 py-3 flex items-center gap-3 text-sm">
                <span className={cn('w-2 h-2 rounded-full', printer.online ? 'bg-success' : 'bg-error')} aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-foreground">{printer.name}</p>
                  <p className="text-xs text-muted-foreground">{printer.stationName ?? 'Sem estação'} · {printer.lastSeenAt ? `último sinal ${formatDateTime(printer.lastSeenAt)}` : 'nunca respondeu'}</p>
                </div>
                <span className={cn('text-xs font-bold px-2 py-0.5 rounded-full', printer.online ? 'bg-success-bg text-success' : 'bg-error-bg text-error')}>{printer.online ? 'Online' : 'Offline'}</span>
                <button disabled={pending} onClick={() => void run(() => sendPrinterHeartbeat(unit.id, printer.id), 'Sinal enviado')} className="text-xs border border-border rounded-lg px-2 py-1 disabled:opacity-50">Enviar sinal</button>
                <button disabled={pending} aria-label={`Excluir impressora ${printer.name}`} onClick={() => void run(() => deletePrinter(unit.id, printer.id), 'Impressora excluída')} className="p-1.5 text-muted-foreground hover:text-error"><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {deleting && (
        <ConfirmDialog
          title="Excluir estação"
          message={`“${deleting.name}” será removida e os itens dela voltam para “Geral”.`}
          confirmLabel="Excluir estação"
          onConfirm={() => run(() => deleteStation(unit.id, deleting.id), 'Estação excluída')}
          onClose={() => setDeleting(null)}
        />
      )}
    </div>
  );
}

function StationRow({ id, name, itemCount, pending, onRename, onDelete }: { id: string; name: string; itemCount: number; pending: boolean; onRename: (name: string) => void; onDelete: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name);
  return (
    <li data-testid="station-row" data-station-id={id} className="px-4 py-3 flex items-center gap-3 text-sm">
      {editing ? (
        <input aria-label={`Novo nome da estação ${name}`} value={value} maxLength={40} onChange={e => setValue(e.target.value)} className={cn(PANEL_INPUT_CLASS, 'py-1.5')} />
      ) : (
        <span className="flex-1 font-medium text-foreground">{name}</span>
      )}
      <span className="text-xs text-muted-foreground whitespace-nowrap">{itemCount} {itemCount === 1 ? 'item' : 'itens'}</span>
      {editing ? (
        <button disabled={pending || !value.trim()} onClick={() => { onRename(value.trim()); setEditing(false); }} className="text-xs border border-border rounded-lg px-2 py-1 disabled:opacity-50">Salvar</button>
      ) : (
        <button onClick={() => setEditing(true)} aria-label={`Renomear estação ${name}`} className="text-xs border border-border rounded-lg px-2 py-1">Renomear</button>
      )}
      <button disabled={pending} aria-label={`Excluir estação ${name}`} onClick={onDelete} className="p-1.5 text-muted-foreground hover:text-error"><Trash2 size={14} /></button>
    </li>
  );
}
