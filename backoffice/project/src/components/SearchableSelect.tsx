import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Search } from 'lucide-react';
import { cn } from '@/lib/utils';

export type SearchableSelectOption = {
  value: string;
  label: string;
  // Shown smaller/lighter next to label in the trigger and each option row
  // — e.g. an employee's emp_id next to their name, or a project's own name
  // next to its code. Also searched, same as label.
  sublabel?: string | null;
};

// A single-select dropdown with a search box, styled to match Select/Input
// in ui.tsx (same border/focus tokens) so it doesn't look like a one-off —
// built the same way EmployeeMultiSelect.tsx already was, since no
// searchable single-select primitive existed in this app's component
// library either (2026-09-22, added once a project list with 800+ real
// entries made a plain <select> genuinely unusable, then applied wherever a
// project or employee is chosen anywhere in the backoffice).
//
// Deliberately NOT built on the native <select> element — a search box
// inside a native dropdown isn't something HTML/CSS can do, so this is a
// fully custom button+panel, same interaction pattern as
// EmployeeMultiSelect's own "Add Employee" popover.
export function SearchableSelect({
  value,
  onChange,
  options,
  label,
  id,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  disabled,
  emptyMessage = 'No matches.',
}: {
  value: string;
  onChange: (v: string) => void;
  options: SearchableSelectOption[];
  label?: string;
  id?: string;
  placeholder?: string;
  searchPlaceholder?: string;
  disabled?: boolean;
  emptyMessage?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value) ?? null;
  const filtered = options.filter((o) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return o.label.toLowerCase().includes(q) || (o.sublabel ?? '').toLowerCase().includes(q);
  });

  useEffect(() => {
    if (!open) return;
    searchInputRef.current?.focus();

    function handleClickOutside(event: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    }
    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false);
        setSearch('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  function select(v: string) {
    onChange(v);
    setSearch('');
    setOpen(false);
  }

  return (
    <div className="flex flex-col gap-1.5" ref={containerRef}>
      {label && (
        <label htmlFor={id} className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</label>
      )}

      <div className="relative">
        <button
          id={id}
          type="button"
          disabled={disabled}
          onClick={() => setOpen((o) => !o)}
          className={cn(
            'flex w-full items-center justify-between gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2.5 text-left text-sm shadow-sm transition-all duration-150 hover:border-slate-400 focus:border-teal-500 focus:outline-none focus:ring-4 focus:ring-teal-500/15 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400',
          )}
        >
          <span className={cn('truncate', selected ? 'text-slate-900' : 'text-slate-400')}>
            {selected ? (
              <>
                {selected.label}
                {selected.sublabel && <span className="text-slate-400"> · {selected.sublabel}</span>}
              </>
            ) : (
              placeholder
            )}
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-slate-400" />
        </button>

        {open && (
          <div className="absolute z-40 mt-1.5 w-full min-w-[16rem] overflow-hidden rounded-lg border border-slate-300 bg-white shadow-lg">
            <div className="flex items-center gap-2 border-b border-slate-200 p-2">
              <Search className="ml-1 h-4 w-4 shrink-0 text-slate-400" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={searchPlaceholder}
                className="w-full border-none bg-transparent px-1 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
              />
            </div>
            <div className="max-h-64 overflow-y-auto">
              {filtered.length === 0 && (
                <div className="px-3 py-4 text-center text-sm text-slate-400">{emptyMessage}</div>
              )}
              {filtered.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  onClick={() => select(o.value)}
                  className={cn(
                    'flex w-full cursor-pointer items-center gap-2.5 border-b border-slate-50 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-slate-50',
                    o.value === value ? 'bg-teal-50/60 text-teal-800' : 'text-slate-700',
                  )}
                >
                  <span className="truncate">{o.label}</span>
                  {o.sublabel && <span className="ml-auto shrink-0 truncate text-xs text-slate-400">{o.sublabel}</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
