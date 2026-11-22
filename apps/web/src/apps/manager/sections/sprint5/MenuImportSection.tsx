import { useRef, useState } from 'react';
import { CheckCircle2, Download, FileSpreadsheet, Upload, XCircle } from 'lucide-react';
import { MENU_IMPORT_COLUMNS, type MenuImportResultDto } from '@filafacil/shared';
import { useAsyncAction } from '@/lib/useAsyncAction';
import { cn } from '@/lib/utils';
import { importMenu, menuTemplateUrl } from '@/services/sprint5Service';
import type { ManagerSectionProps } from '../../types';

const STATUS = {
  created: { label: 'Criado', className: 'text-success' },
  updated: { label: 'Atualizado', className: 'text-blue-500' },
  valid: { label: 'Válido', className: 'text-success' },
  error: { label: 'Erro', className: 'text-error' },
} as const;

/** Baixa um texto como arquivo (planilha de erros gerada pelo servidor). */
function download(name: string, content: string) {
  const url = URL.createObjectURL(new Blob([content], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Ficha 54: importar o cardápio em massa. Baixe o modelo, preencha, valide (sem gravar) e importe. Itens com o
 * mesmo nome na mesma categoria são atualizados; linhas com erro voltam numa planilha para corrigir e reimportar.
 */
export default function MenuImportSection({ unit, notify }: ManagerSectionProps) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<MenuImportResultDto | null>(null);
  const { run, pending } = useAsyncAction(notify);

  async function send(dryRun: boolean) {
    if (!file) return;
    const response = await run(() => importMenu(unit.id, file, dryRun));
    if (!response) return;
    setResult(response);
    if (!dryRun) notify(`Importação concluída: ${response.created} criado(s), ${response.updated} atualizado(s), ${response.failed} com erro.`);
  }

  return (
    <div className="p-6 flex flex-col gap-5 max-w-5xl">
      <ol className="grid sm:grid-cols-3 gap-3 text-sm">
        <li className="bg-card border border-border rounded-xl p-4 flex flex-col gap-2">
          <span className="font-semibold">1. Baixe o modelo</span>
          <span className="text-muted-foreground text-xs">Colunas: {MENU_IMPORT_COLUMNS.join(', ')}. Obrigatórias: nome, categoria e preço (ex.: 28,90).</span>
          <a href={menuTemplateUrl(unit.id)} download data-testid="menu-template" className="mt-auto inline-flex items-center gap-2 border border-border rounded-xl px-3 py-2 text-sm hover:bg-muted w-fit"><Download size={14} />Modelo CSV</a>
        </li>
        <li className="bg-card border border-border rounded-xl p-4 flex flex-col gap-2">
          <span className="font-semibold">2. Escolha a planilha</span>
          <span className="text-muted-foreground text-xs">No Excel ou Google Planilhas: salvar/baixar como CSV.</span>
          <input
            ref={input}
            type="file"
            accept=".csv,text/csv"
            aria-label="Planilha do cardápio"
            className="hidden"
            onChange={event => {
              setFile(event.target.files?.[0] ?? null);
              setResult(null);
            }}
          />
          <button onClick={() => input.current?.click()} className="mt-auto inline-flex items-center gap-2 border border-border rounded-xl px-3 py-2 text-sm hover:bg-muted w-fit"><FileSpreadsheet size={14} />{file ? file.name : 'Selecionar arquivo'}</button>
        </li>
        <li className="bg-card border border-border rounded-xl p-4 flex flex-col gap-2">
          <span className="font-semibold">3. Valide e importe</span>
          <span className="text-muted-foreground text-xs">Validar mostra o relatório sem gravar nada. Importar grava as linhas corretas.</span>
          <div className="mt-auto flex gap-2">
            <button disabled={!file || pending} onClick={() => void send(true)} data-testid="menu-validate" className="border border-border rounded-xl px-3 py-2 text-sm hover:bg-muted disabled:opacity-50">Validar</button>
            <button disabled={!file || pending} onClick={() => void send(false)} data-testid="menu-import" className="inline-flex items-center gap-2 bg-primary text-primary-foreground rounded-xl px-3 py-2 text-sm font-medium disabled:opacity-50"><Upload size={14} />{pending ? 'Enviando…' : 'Importar'}</button>
          </div>
        </li>
      </ol>

      {result && (
        <div className="flex flex-col gap-3" data-testid="import-report">
          <div className={cn('rounded-xl border px-4 py-3 text-sm flex items-center gap-3 flex-wrap', result.failed ? 'bg-warning-bg border-warning/30' : 'bg-success-bg border-success/20')}>
            {result.failed ? <XCircle size={16} className="text-warning" /> : <CheckCircle2 size={16} className="text-success" />}
            <span className="font-medium">
              {result.dryRun ? 'Validação' : 'Importação'}: {result.total} linha(s) · {result.dryRun ? `${result.total - result.failed} válida(s)` : `${result.created} criada(s) · ${result.updated} atualizada(s)`} · {result.failed} com erro
            </span>
            <span className="text-xs text-muted-foreground">em {(result.durationMs / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} s</span>
            {result.errorCsv && (
              <button onClick={() => download(`erros-${file?.name ?? 'cardapio.csv'}`, result.errorCsv as string)} data-testid="download-errors" className="ml-auto inline-flex items-center gap-2 border border-border bg-card rounded-xl px-3 py-1.5 text-sm hover:bg-muted"><Download size={14} />Planilha com os erros</button>
            )}
          </div>
          {result.failed > 0 && <p className="text-xs text-muted-foreground">Corrija as linhas na planilha de erros (a coluna "erro" explica cada problema) e importe de novo: os itens já importados não duplicam.</p>}
          <div className="bg-card rounded-xl border border-border overflow-x-auto max-h-[28rem]">
            <table className="w-full min-w-[520px]">
              <thead className="bg-muted/50 sticky top-0"><tr className="text-left text-xs text-muted-foreground uppercase tracking-wider"><th className="px-4 py-2">Linha</th><th className="px-4 py-2">Item</th><th className="px-4 py-2">Resultado</th></tr></thead>
              <tbody>
                {[...result.rows].sort((a, b) => Number(b.status === 'error') - Number(a.status === 'error') || a.line - b.line).map(row => (
                  <tr key={row.line} data-testid="import-row" data-status={row.status} className="border-t border-border text-sm align-top">
                    <td className="px-4 py-2 text-muted-foreground">{row.line}</td>
                    <td className="px-4 py-2">{row.name || <em className="text-muted-foreground">sem nome</em>}</td>
                    <td className="px-4 py-2"><span className={cn('font-medium', STATUS[row.status].className)}>{STATUS[row.status].label}</span>{row.errors.length > 0 && <ul className="text-xs text-error mt-0.5 list-disc ml-4">{row.errors.map(error => <li key={error}>{error}</li>)}</ul>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
