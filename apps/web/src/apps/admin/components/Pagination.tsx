import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onChange: (page: number) => void;
}

/** Navegação das listagens paginadas pelo servidor. */
export default function Pagination({ page, pageSize, total, onChange }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total <= pageSize) return null;
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-border text-xs text-muted-foreground">
      <span>
        {first}–{last} de {total}
      </span>
      <div className="flex items-center gap-1">
        <button onClick={() => onChange(page - 1)} disabled={page <= 1} aria-label="Página anterior" className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30">
          <ChevronLeft size={14} />
        </button>
        <span className="px-2">
          {page} / {pages}
        </span>
        <button onClick={() => onChange(page + 1)} disabled={page >= pages} aria-label="Próxima página" className="p-1.5 rounded-lg hover:bg-muted disabled:opacity-30">
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
