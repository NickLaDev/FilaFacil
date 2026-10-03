import { Search, X } from 'lucide-react';

interface SearchBoxProps {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}

export default function SearchBox({ value, onChange, placeholder }: SearchBoxProps) {
  return (
    <div className="flex-1 min-w-56 flex items-center gap-2 bg-muted border border-border rounded-xl px-3 py-2">
      <Search size={14} className="text-muted-foreground flex-shrink-0" />
      <input
        value={value}
        onChange={event => onChange(event.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        maxLength={80}
        className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
      />
      {value && (
        <button onClick={() => onChange('')} aria-label="Limpar busca">
          <X size={13} className="text-muted-foreground" />
        </button>
      )}
    </div>
  );
}
