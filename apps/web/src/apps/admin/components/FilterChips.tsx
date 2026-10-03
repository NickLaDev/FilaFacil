import { cn } from '@/lib/utils';

export interface FilterOption<T extends string> {
  id: T;
  label: string;
  count?: number;
}

interface FilterChipsProps<T extends string> {
  options: FilterOption<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
}

export default function FilterChips<T extends string>({ options, value, onChange, label }: FilterChipsProps<T>) {
  return (
    <div className="flex items-center gap-2 flex-wrap" role="group" aria-label={label}>
      {options.map(option => (
        <button
          key={option.id}
          onClick={() => onChange(option.id)}
          aria-pressed={value === option.id}
          className={cn(
            'px-4 py-1.5 rounded-full text-sm font-medium transition-colors',
            value === option.id ? 'bg-primary text-white' : 'bg-muted text-muted-foreground hover:text-foreground',
          )}
        >
          {option.label}
          {option.count !== undefined && <span className="ml-1.5 text-xs opacity-70">{option.count}</span>}
        </button>
      ))}
    </div>
  );
}
