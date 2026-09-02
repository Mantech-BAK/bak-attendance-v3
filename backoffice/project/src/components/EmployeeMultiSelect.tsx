import { useEffect, useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import type { Employee } from '@/lib/api';

// No searchable-multi-select primitive exists in this app's component
// library (only the native-<select>-backed Select in ui.tsx) — built from
// scratch for bulk task assignment, styled to match Select/Input's
// border/focus tokens so it doesn't look like a one-off.
export function EmployeeMultiSelect({
  employees,
  selected,
  onChange,
  label,
  id,
}: {
  employees: Employee[];
  selected: string[];
  onChange: (empIds: string[]) => void;
  label?: string;
  id?: string;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  const selectedEmployees = selected
    .map((empId) => employees.find((e) => e.emp_id === empId))
    .filter((e): e is Employee => e !== undefined);

  const available = employees.filter((e) => !selected.includes(e.emp_id));
  const filtered = available.filter((e) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return e.name.toLowerCase().includes(q) || e.emp_id.toLowerCase().includes(q);
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
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [open]);

  function add(empId: string) {
    onChange([...selected, empId]);
    setSearch('');
    setOpen(false);
  }

  function remove(empId: string) {
    onChange(selected.filter((id) => id !== empId));
  }

  return (
    <div className="flex flex-col gap-1.5" ref={containerRef}>
      {label && (
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium text-slate-700">{label}</span>
          <span className="text-xs text-slate-500">{selected.length} selected</span>
        </div>
      )}

      {selectedEmployees.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {selectedEmployees.map((e) => (
            <span
              key={e.emp_id}
              className="inline-flex items-center gap-1.5 rounded-full bg-teal-50 py-1 pl-3 pr-1.5 text-sm text-teal-800 ring-1 ring-inset ring-teal-200"
            >
              <span className="truncate">{e.name}</span>
              <span className="shrink-0 text-xs text-teal-600">{e.emp_id}</span>
              <button
                type="button"
                onClick={() => remove(e.emp_id)}
                className="rounded-full p-0.5 text-teal-500 transition hover:bg-teal-100 hover:text-teal-700"
                aria-label={`Remove ${e.name}`}
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="relative">
        <button
          id={id}
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm font-medium text-slate-600 transition hover:border-teal-400 hover:bg-teal-50 hover:text-teal-700"
        >
          <Plus className="h-4 w-4" />
          Add Employee
        </button>

        {open && (
          <div className="absolute z-10 mt-1.5 w-72 overflow-hidden rounded-lg border border-slate-300 bg-white shadow-lg">
            <div className="border-b border-slate-200 p-2">
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search employees…"
                className="w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20"
              />
            </div>
            <div className="max-h-56 overflow-y-auto">
              {filtered.length === 0 && (
                <div className="px-3 py-4 text-center text-sm text-slate-400">
                  {available.length === 0 ? 'All employees added.' : 'No employees match.'}
                </div>
              )}
              {filtered.map((e) => (
                <button
                  key={e.emp_id}
                  type="button"
                  onClick={() => add(e.emp_id)}
                  className="flex w-full cursor-pointer items-center gap-2.5 border-b border-slate-50 px-3 py-2 text-left text-sm text-slate-700 last:border-b-0 hover:bg-slate-50"
                >
                  <span className="truncate">{e.name}</span>
                  <span className="ml-auto shrink-0 text-xs text-slate-400">{e.emp_id}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
