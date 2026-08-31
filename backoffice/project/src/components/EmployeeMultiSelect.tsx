import { useState } from 'react';
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
  const [search, setSearch] = useState('');

  const filtered = employees.filter((e) => {
    const q = search.trim().toLowerCase();
    if (!q) return true;
    return e.name.toLowerCase().includes(q) || e.emp_id.toLowerCase().includes(q);
  });

  function toggle(empId: string) {
    onChange(selected.includes(empId) ? selected.filter((id) => id !== empId) : [...selected, empId]);
  }

  return (
    <div className="flex flex-col gap-1.5">
      {label && (
        <div className="flex items-center justify-between">
          <label htmlFor={id} className="text-sm font-medium text-slate-700">{label}</label>
          <span className="text-xs text-slate-500">{selected.length} selected</span>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm">
        <div className="border-b border-slate-200 p-2">
          <input
            id={id}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search employees…"
            className="w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-teal-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-teal-500/20"
          />
        </div>

        <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-xs">
          <button type="button" onClick={() => onChange(filtered.map((e) => e.emp_id))} className="font-medium text-teal-700 hover:text-teal-800">
            Select all{search.trim() ? ' (filtered)' : ''}
          </button>
          <button type="button" onClick={() => onChange([])} className="font-medium text-slate-500 hover:text-slate-700">
            Clear
          </button>
        </div>

        <div className="max-h-56 overflow-y-auto">
          {filtered.length === 0 && (
            <div className="px-3 py-4 text-center text-sm text-slate-400">No employees match.</div>
          )}
          {filtered.map((e) => (
            <label
              key={e.emp_id}
              className="flex cursor-pointer items-center gap-2.5 border-b border-slate-50 px-3 py-2 text-sm text-slate-700 last:border-b-0 hover:bg-slate-50"
            >
              <input
                type="checkbox"
                checked={selected.includes(e.emp_id)}
                onChange={() => toggle(e.emp_id)}
                className="h-4 w-4 rounded border-slate-300 text-teal-600 focus:ring-teal-500/40"
              />
              <span className="truncate">{e.name}</span>
              <span className="ml-auto shrink-0 text-xs text-slate-400">{e.emp_id}</span>
            </label>
          ))}
        </div>
      </div>
    </div>
  );
}
