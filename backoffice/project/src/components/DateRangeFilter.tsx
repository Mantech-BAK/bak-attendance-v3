import { Calendar } from 'lucide-react';
import { FIELD_LABEL } from '@/components/ui';
import { PRESETS, presetRange, singleDayRange, type DateRange } from '@/lib/dateRange';
import { cn } from '@/lib/utils';

// Date picker (exact day) plus rolling-window presets, shared by Punches,
// Tasks and Approvals. Picking a day clears any active preset; picking a
// preset clears the exact day.
export function DateRangeFilter({ id, value, onChange }: { id: string; value: DateRange; onChange: (r: DateRange) => void }) {
  const isSingleDay = value.start === value.end;
  return (
    <div className="flex flex-col gap-1.5 !w-auto">
      <div className="flex items-baseline gap-2">
        <label htmlFor={id} className={FIELD_LABEL}>Date</label>
        {!isSingleDay && <span className="text-xs normal-case text-slate-400">{value.start} to {value.end}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative">
          <Calendar className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            id={id}
            type="date"
            value={isSingleDay ? value.start : ''}
            onChange={(e) => e.target.value && onChange(singleDayRange(e.target.value))}
            className="rounded-lg border border-slate-300 bg-white py-2.5 pl-10 pr-3 text-sm text-slate-900 shadow-sm transition hover:border-slate-400 focus:border-teal-500 focus:outline-none focus:ring-4 focus:ring-teal-500/15"
          />
        </div>
        <div className="flex flex-wrap gap-1 rounded-lg bg-slate-100 p-1" role="group" aria-label="Quick range">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              data-preset={p.key}
              onClick={() => onChange(presetRange(p.key))}
              className={cn(
                'rounded-md px-3 py-1.5 text-xs font-medium transition',
                value.preset === p.key ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700',
              )}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
