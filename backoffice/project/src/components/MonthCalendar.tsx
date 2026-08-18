import { useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function dateKey(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

// Client-side month grid over already-fetched data — no dedicated calendar
// endpoint. activityByDate keys are 'YYYY-MM-DD', values are punch counts
// for that day; a day cell with activity shows a count pill.
export function MonthCalendar({ activityByDate }: { activityByDate: Record<string, number> }) {
  const today = new Date();
  const [viewYear, setViewYear] = useState(today.getUTCFullYear());
  const [viewMonth, setViewMonth] = useState(today.getUTCMonth());

  const todayKey = dateKey(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const firstOfMonth = new Date(Date.UTC(viewYear, viewMonth, 1));
  const daysInMonth = new Date(Date.UTC(viewYear, viewMonth + 1, 0)).getUTCDate();
  const leadingBlanks = firstOfMonth.getUTCDay();

  const cells: Array<{ day: number; key: string } | null> = [];
  for (let i = 0; i < leadingBlanks; i++) cells.push(null);
  for (let day = 1; day <= daysInMonth; day++) cells.push({ day, key: dateKey(viewYear, viewMonth, day) });

  function goPrevMonth() {
    if (viewMonth === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  }

  function goNextMonth() {
    if (viewMonth === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  }

  const monthLabel = firstOfMonth.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <p className="text-sm font-semibold text-slate-900">{monthLabel}</p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={goPrevMonth}
            className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Previous month"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={goNextMonth}
            className="rounded-md p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            aria-label="Next month"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1 text-center">
        {WEEKDAYS.map((w) => (
          <div key={w} className="py-1 text-xs font-medium text-slate-400">{w}</div>
        ))}
        {cells.map((cell, i) => {
          if (!cell) return <div key={`blank-${i}`} />;
          const count = activityByDate[cell.key] ?? 0;
          const isToday = cell.key === todayKey;
          return (
            <div
              key={cell.key}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 rounded-lg py-2 text-sm',
                isToday ? 'bg-teal-600 font-semibold text-white' : 'text-slate-700',
                !isToday && count > 0 && 'bg-teal-50',
              )}
            >
              <span>{cell.day}</span>
              {count > 0 && (
                <span className={cn('text-[10px] font-semibold', isToday ? 'text-teal-50' : 'text-teal-600')}>
                  {count}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
