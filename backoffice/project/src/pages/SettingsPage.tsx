import { useEffect, useState, type FormEvent } from 'react';
import { Clock, Moon, Sunrise, CheckCircle2, XCircle, Loader2, CalendarRange } from 'lucide-react';
import {
  fetchDailyWorkingHours,
  saveDailyWorkingHours,
  fetchRamzanPeriods,
  declareRamzanPeriod,
  fetchRamzanWorkingHours,
  saveRamzanWorkingHours,
  fetchEmployees,
} from '@/lib/api';
import type { RamzanPeriod, Employee } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Card, Button, Input, Select, Spinner, EmptyState, Badge } from '@/components/ui';
import { formatDate } from '@/lib/utils';

const TODAY = new Date().toISOString().slice(0, 10);

export function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [employees, setEmployees] = useState<Employee[]>([]);

  const [hours, setHours] = useState('');
  const [currentHours, setCurrentHours] = useState<number | null>(null);
  const [hoursSubmitting, setHoursSubmitting] = useState(false);
  const [hoursError, setHoursError] = useState<string | null>(null);
  const [hoursSuccess, setHoursSuccess] = useState(false);

  const [periods, setPeriods] = useState<RamzanPeriod[]>([]);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [declaredBy, setDeclaredBy] = useState('');
  const [periodSubmitting, setPeriodSubmitting] = useState(false);
  const [periodError, setPeriodError] = useState<string | null>(null);
  const [periodSuccess, setPeriodSuccess] = useState(false);

  const [ramzanHours, setRamzanHours] = useState('');
  const [currentRamzanHours, setCurrentRamzanHours] = useState<number | null>(null);
  const [ramzanHoursSubmitting, setRamzanHoursSubmitting] = useState(false);
  const [ramzanHoursError, setRamzanHoursError] = useState<string | null>(null);
  const [ramzanHoursSuccess, setRamzanHoursSuccess] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const [dwh, rp, rwh, emp] = await Promise.all([
      fetchDailyWorkingHours(),
      fetchRamzanPeriods(),
      fetchRamzanWorkingHours(),
      fetchEmployees(),
    ]);
    setCurrentHours(dwh.hours);
    setHours(dwh.hours !== null ? String(dwh.hours) : '');
    setPeriods(rp.periods);
    setCurrentRamzanHours(rwh.hours);
    setRamzanHours(rwh.hours !== null ? String(rwh.hours) : '');
    setEmployees(emp);
    setLoading(false);
  }

  async function handleRamzanHoursSubmit(e: FormEvent) {
    e.preventDefault();
    setRamzanHoursError(null);
    setRamzanHoursSuccess(false);

    const parsed = Number(ramzanHours);
    if (!ramzanHours || Number.isNaN(parsed)) {
      setRamzanHoursError('Enter a valid number of hours.');
      return;
    }

    setRamzanHoursSubmitting(true);
    try {
      const result = await saveRamzanWorkingHours(parsed);
      setCurrentRamzanHours(result.hours);
      setRamzanHoursSuccess(true);
      setTimeout(() => setRamzanHoursSuccess(false), 3000);
    } catch (err) {
      setRamzanHoursError(err instanceof Error ? err.message : 'Could not save. Please try again.');
    } finally {
      setRamzanHoursSubmitting(false);
    }
  }

  async function handleHoursSubmit(e: FormEvent) {
    e.preventDefault();
    setHoursError(null);
    setHoursSuccess(false);

    const parsed = Number(hours);
    if (!hours || Number.isNaN(parsed)) {
      setHoursError('Enter a valid number of hours.');
      return;
    }

    setHoursSubmitting(true);
    try {
      const result = await saveDailyWorkingHours(parsed);
      setCurrentHours(result.hours);
      setHoursSuccess(true);
      setTimeout(() => setHoursSuccess(false), 3000);
    } catch (err) {
      setHoursError(err instanceof Error ? err.message : 'Could not save. Please try again.');
    } finally {
      setHoursSubmitting(false);
    }
  }

  async function handlePeriodSubmit(e: FormEvent) {
    e.preventDefault();
    setPeriodError(null);
    setPeriodSuccess(false);

    if (!startDate || !endDate || !declaredBy) {
      setPeriodError('Start date, end date, and declared by are all required.');
      return;
    }

    setPeriodSubmitting(true);
    try {
      const result = await declareRamzanPeriod({ start_date: startDate, end_date: endDate, declared_by: declaredBy });
      setPeriods(result.periods);
      setStartDate('');
      setEndDate('');
      setDeclaredBy('');
      setPeriodSuccess(true);
      setTimeout(() => setPeriodSuccess(false), 3000);
    } catch (err) {
      setPeriodError(err instanceof Error ? err.message : 'Could not declare the period. Please try again.');
    } finally {
      setPeriodSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Settings" subtitle="System-wide attendance configuration." />
        <Spinner />
      </div>
    );
  }

  const sortedPeriods = [...periods].sort((a, b) => (a.start_date < b.start_date ? -1 : a.start_date > b.start_date ? 1 : 0));

  return (
    <div>
      <PageHeader title="Settings" subtitle="System-wide attendance configuration." />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card className="p-6">
          <div className="mb-4 flex items-center gap-2">
            <Clock className="h-5 w-5 text-slate-400" />
            <h2 className="text-base font-semibold text-slate-900">Daily Working Hours</h2>
          </div>
          <p className="mb-4 text-sm text-slate-500">
            Sets today's expected working hours, used as the overtime threshold for everyone unless a Ramzan
            override applies. Cannot be backdated — this always applies to today only.
          </p>

          <form onSubmit={handleHoursSubmit} className="space-y-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700">Date</span>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-500">
                {formatDate(TODAY)} (locked)
              </div>
            </div>

            <Input
              value={hours}
              onChange={setHours}
              label="Hours"
              id="daily-hours"
              type="number"
              placeholder="e.g. 8.5"
            />
            {currentHours !== null && (
              <p className="text-xs text-slate-400">Currently set to {currentHours}h for today.</p>
            )}

            {hoursError && (
              <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
                <XCircle className="h-4 w-4 shrink-0" />{hoursError}
              </div>
            )}
            {hoursSuccess && (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-200">
                <CheckCircle2 className="h-4 w-4 shrink-0" />Saved.
              </div>
            )}

            <Button type="submit" disabled={hoursSubmitting} className="w-full">
              {hoursSubmitting ? (<><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>) : 'Save'}
            </Button>
          </form>
        </Card>

        <Card className="p-6">
          <div className="mb-4 flex items-center gap-2">
            <Moon className="h-5 w-5 text-slate-400" />
            <h2 className="text-base font-semibold text-slate-900">Declare Ramzan Period</h2>
          </div>
          <p className="mb-4 text-sm text-slate-500">
            Muslim employees get the Ramzan Working Hours threshold (set in the card below) on any day within a
            declared period, overriding everything else. Start date cannot be earlier than today; no restriction on
            how far in the future.
          </p>

          <form onSubmit={handlePeriodSubmit} className="space-y-4">
            <Input value={startDate} onChange={setStartDate} label="Start Date" id="ramzan-start" type="date" />
            <Input value={endDate} onChange={setEndDate} label="End Date" id="ramzan-end" type="date" />
            <Select value={declaredBy} onChange={setDeclaredBy} label="Declared By" id="ramzan-declared-by">
              <option value="">Select admin…</option>
              {employees.map((e) => (<option key={e.emp_id} value={e.emp_id}>{e.name}</option>))}
            </Select>

            {periodError && (
              <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
                <XCircle className="h-4 w-4 shrink-0" />{periodError}
              </div>
            )}
            {periodSuccess && (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-200">
                <CheckCircle2 className="h-4 w-4 shrink-0" />Period declared.
              </div>
            )}

            <Button type="submit" disabled={periodSubmitting} className="w-full">
              {periodSubmitting ? (<><Loader2 className="h-4 w-4 animate-spin" /> Declaring…</>) : 'Declare Period'}
            </Button>
          </form>
        </Card>

        <Card className="p-6">
          <div className="mb-4 flex items-center gap-2">
            <Sunrise className="h-5 w-5 text-slate-400" />
            <h2 className="text-base font-semibold text-slate-900">Ramzan Working Hours</h2>
          </div>
          <p className="mb-4 text-sm text-slate-500">
            Daily working hours for Muslim employees during a declared Ramzan period — replaces Daily Working Hours
            and the global default whenever both apply. Defaults to 6h if never set.
          </p>

          <form onSubmit={handleRamzanHoursSubmit} className="space-y-4">
            <Input
              value={ramzanHours}
              onChange={setRamzanHours}
              label="Hours (1–8)"
              id="ramzan-hours"
              type="number"
              placeholder="e.g. 6"
            />
            <p className="text-xs text-slate-400">
              {currentRamzanHours !== null ? `Currently set to ${currentRamzanHours}h.` : 'Not customized yet — defaults to 6h.'}
            </p>

            {ramzanHoursError && (
              <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
                <XCircle className="h-4 w-4 shrink-0" />{ramzanHoursError}
              </div>
            )}
            {ramzanHoursSuccess && (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-200">
                <CheckCircle2 className="h-4 w-4 shrink-0" />Saved.
              </div>
            )}

            <Button type="submit" disabled={ramzanHoursSubmitting} className="w-full">
              {ramzanHoursSubmitting ? (<><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>) : 'Save'}
            </Button>
          </form>
        </Card>
      </div>

      <div className="mt-6">
        <div className="mb-4 flex items-center gap-2">
          <CalendarRange className="h-5 w-5 text-slate-400" />
          <h2 className="text-base font-semibold text-slate-900">Declared Ramzan Periods</h2>
          <Badge variant="neutral">{sortedPeriods.length}</Badge>
        </div>

        {sortedPeriods.length === 0 ? (
          <Card className="p-6">
            <EmptyState icon={<CalendarRange className="h-6 w-6" />} title="No periods declared" message="Declare a Ramzan period using the form above." />
          </Card>
        ) : (
          <Card className="divide-y divide-slate-100">
            {sortedPeriods.map((p, i) => {
              const declarer = employees.find((e) => e.emp_id === p.declared_by);
              const isPast = p.end_date < TODAY;
              const isActive = p.start_date <= TODAY && TODAY <= p.end_date;
              return (
                <div key={`${p.start_date}-${p.end_date}-${i}`} className="flex items-center justify-between gap-4 p-5">
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {formatDate(p.start_date)} – {formatDate(p.end_date)}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      Declared by {declarer?.name ?? p.declared_by} · {formatDate(p.declared_at)}
                    </p>
                  </div>
                  <Badge variant={isActive ? 'accent' : isPast ? 'neutral' : 'info'}>
                    {isActive ? 'Active now' : isPast ? 'Past' : 'Upcoming'}
                  </Badge>
                </div>
              );
            })}
          </Card>
        )}
      </div>
    </div>
  );
}
