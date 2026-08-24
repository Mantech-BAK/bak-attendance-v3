import { useEffect, useState, type FormEvent } from 'react';
import { Clock, Moon, Copy, CheckCircle2, XCircle, Loader2, CalendarRange, Trash2, AlertTriangle, Pencil, Power, PowerOff, Siren } from 'lucide-react';
import {
  fetchDailyWorkingHours,
  saveDailyWorkingHours,
  fetchRamzanPeriods,
  declareRamzanPeriod,
  updateRamzanPeriod,
  deleteRamzanPeriod,
  fetchRamzanWorkingHours,
  saveRamzanWorkingHours,
  fetchDuplicatePunchWindow,
  saveDuplicatePunchWindow,
  fetchEmergencyTimeAllowance,
  saveEmergencyTimeAllowance,
  fetchEmployees,
  resetTestData,
  ApiError,
} from '@/lib/api';
import type { RamzanPeriod, Employee } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Card, Button, Input, Select, Spinner, EmptyState, Badge, Modal } from '@/components/ui';
import { formatDate } from '@/lib/utils';
import { useAuth } from '@/lib/auth';

const RESET_TABLES_LABEL = 'punches, tasks, exceptions, overtime approvals, and confirmation-sheet records';

const TODAY = new Date().toISOString().slice(0, 10);

export function SettingsPage() {
  const { session } = useAuth();
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
  const [ramzanHours, setRamzanHours] = useState('');
  const [currentRamzanHours, setCurrentRamzanHours] = useState<number | null>(null);
  const [periodSubmitting, setPeriodSubmitting] = useState(false);
  const [periodError, setPeriodError] = useState<string | null>(null);
  const [periodSuccess, setPeriodSuccess] = useState(false);

  const [duplicateWindow, setDuplicateWindow] = useState('');
  const [currentDuplicateWindow, setCurrentDuplicateWindow] = useState<number | null>(null);
  const [duplicateWindowSubmitting, setDuplicateWindowSubmitting] = useState(false);
  const [duplicateWindowError, setDuplicateWindowError] = useState<string | null>(null);
  const [duplicateWindowSuccess, setDuplicateWindowSuccess] = useState(false);

  const [emergencyStart, setEmergencyStart] = useState('');
  const [emergencyEnd, setEmergencyEnd] = useState('');
  // Ticks once a minute so the "your local time right now" cross-check next
  // to the UTC fields stays current for as long as the admin has this page
  // open, without needing a full page reload.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(interval);
  }, []);
  const nowLocalTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const nowUtcTime = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  const [emergencySubmitting, setEmergencySubmitting] = useState(false);
  const [emergencyError, setEmergencyError] = useState<string | null>(null);
  const [emergencySuccess, setEmergencySuccess] = useState(false);

  const [editingPeriod, setEditingPeriod] = useState<RamzanPeriod | null>(null);
  const [editStartDate, setEditStartDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [editSubmitting, setEditSubmitting] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  const [deletingPeriod, setDeletingPeriod] = useState<RamzanPeriod | null>(null);
  const [periodDeleting, setPeriodDeleting] = useState(false);
  const [periodDeleteError, setPeriodDeleteError] = useState<string | null>(null);

  const [togglingPeriodId, setTogglingPeriodId] = useState<string | null>(null);

  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetConfirmText, setResetConfirmText] = useState('');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetSuccess, setResetSuccess] = useState(false);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    const [dwh, rp, rwh, dpw, eta, emp] = await Promise.all([
      fetchDailyWorkingHours(),
      fetchRamzanPeriods(),
      fetchRamzanWorkingHours(),
      fetchDuplicatePunchWindow(),
      fetchEmergencyTimeAllowance(),
      fetchEmployees(),
    ]);
    setCurrentHours(dwh.hours);
    setHours(dwh.hours !== null ? String(dwh.hours) : '');
    setPeriods(rp.periods);
    setCurrentRamzanHours(rwh.hours);
    setRamzanHours(rwh.hours !== null ? String(rwh.hours) : '');
    setCurrentDuplicateWindow(dpw.minutes);
    setDuplicateWindow(String(dpw.minutes));
    setEmergencyStart(eta.start);
    setEmergencyEnd(eta.end);
    setEmployees(emp);
    setLoading(false);
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

  // One combined submit — declaring a period and setting the working-hours
  // override that applies during it are a single admin action now, not two
  // separate settings a supervisor has to remember to configure together.
  async function handlePeriodSubmit(e: FormEvent) {
    e.preventDefault();
    setPeriodError(null);
    setPeriodSuccess(false);

    if (!startDate || !endDate) {
      setPeriodError('Start date and end date are both required.');
      return;
    }

    const parsedHours = Number(ramzanHours);
    if (!ramzanHours || Number.isNaN(parsedHours)) {
      setPeriodError('Enter a valid number of working hours for this period.');
      return;
    }

    setPeriodSubmitting(true);
    try {
      const [periodResult, hoursResult] = await Promise.all([
        declareRamzanPeriod({ start_date: startDate, end_date: endDate }),
        saveRamzanWorkingHours(parsedHours),
      ]);
      setPeriods(periodResult.periods);
      setCurrentRamzanHours(hoursResult.hours);
      setStartDate('');
      setEndDate('');
      setPeriodSuccess(true);
      setTimeout(() => setPeriodSuccess(false), 3000);
    } catch (err) {
      setPeriodError(err instanceof Error ? err.message : 'Could not declare the period. Please try again.');
    } finally {
      setPeriodSubmitting(false);
    }
  }

  function openEditPeriod(p: RamzanPeriod) {
    setEditingPeriod(p);
    setEditStartDate(p.start_date);
    setEditEndDate(p.end_date);
    setEditError(null);
  }

  async function handleEditSubmit(e: FormEvent) {
    e.preventDefault();
    if (!editingPeriod) return;
    setEditError(null);

    if (!editStartDate || !editEndDate) {
      setEditError('Start date and end date are both required.');
      return;
    }

    setEditSubmitting(true);
    try {
      const result = await updateRamzanPeriod(editingPeriod.id, { start_date: editStartDate, end_date: editEndDate });
      setPeriods(result.periods);
      setEditingPeriod(null);
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : 'Could not save changes. Please try again.');
    } finally {
      setEditSubmitting(false);
    }
  }

  async function handleToggleActive(p: RamzanPeriod) {
    setTogglingPeriodId(p.id);
    try {
      const result = await updateRamzanPeriod(p.id, { active: !p.active });
      setPeriods(result.periods);
    } catch (err) {
      window.alert(err instanceof ApiError ? err.message : 'Could not update the period. Please try again.');
    } finally {
      setTogglingPeriodId(null);
    }
  }

  async function handleConfirmDeletePeriod() {
    if (!deletingPeriod) return;
    setPeriodDeleteError(null);
    setPeriodDeleting(true);
    try {
      await deleteRamzanPeriod(deletingPeriod.id);
      setPeriods((prev) => prev.filter((p) => p.id !== deletingPeriod.id));
      setDeletingPeriod(null);
    } catch (err) {
      setPeriodDeleteError(err instanceof ApiError ? err.message : 'Could not delete the period. Please try again.');
    } finally {
      setPeriodDeleting(false);
    }
  }

  async function handleDuplicateWindowSubmit(e: FormEvent) {
    e.preventDefault();
    setDuplicateWindowError(null);
    setDuplicateWindowSuccess(false);

    const parsed = Number(duplicateWindow);
    if (!duplicateWindow || Number.isNaN(parsed)) {
      setDuplicateWindowError('Enter a valid number of minutes.');
      return;
    }

    setDuplicateWindowSubmitting(true);
    try {
      const result = await saveDuplicatePunchWindow(parsed);
      setCurrentDuplicateWindow(result.minutes);
      setDuplicateWindowSuccess(true);
      setTimeout(() => setDuplicateWindowSuccess(false), 3000);
    } catch (err) {
      setDuplicateWindowError(err instanceof Error ? err.message : 'Could not save. Please try again.');
    } finally {
      setDuplicateWindowSubmitting(false);
    }
  }

  async function handleEmergencySubmit(e: FormEvent) {
    e.preventDefault();
    setEmergencyError(null);
    setEmergencySuccess(false);

    if (!emergencyStart || !emergencyEnd) {
      setEmergencyError('Both a start and an end time are required.');
      return;
    }

    setEmergencySubmitting(true);
    try {
      const result = await saveEmergencyTimeAllowance(emergencyStart, emergencyEnd);
      setEmergencyStart(result.start);
      setEmergencyEnd(result.end);
      setEmergencySuccess(true);
      setTimeout(() => setEmergencySuccess(false), 3000);
    } catch (err) {
      setEmergencyError(err instanceof Error ? err.message : 'Could not save. Please try again.');
    } finally {
      setEmergencySubmitting(false);
    }
  }

  function openResetConfirm() {
    setResetConfirmText('');
    setResetError(null);
    setShowResetConfirm(true);
  }

  async function handleConfirmReset() {
    if (resetConfirmText !== 'RESET') return;
    setResetError(null);
    setResetting(true);
    try {
      await resetTestData();
      setShowResetConfirm(false);
      setResetSuccess(true);
      setTimeout(() => setResetSuccess(false), 4000);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Could not reset test data. Please try again.');
    } finally {
      setResetting(false);
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
            Declares the period and sets the working-hours threshold Muslim employees get on any day within it —
            one combined action. Overrides Daily Working Hours and the global default whenever both apply. Start
            date cannot be earlier than today; no restriction on how far in the future.
          </p>

          <form onSubmit={handlePeriodSubmit} className="space-y-4">
            <Input value={startDate} onChange={setStartDate} label="Start Date" id="ramzan-start" type="date" />
            <Input value={endDate} onChange={setEndDate} label="End Date" id="ramzan-end" type="date" />
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-slate-700">Declared By</span>
              <div className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm text-slate-700">
                {session?.name ?? session?.empId}
              </div>
            </div>
            <Input
              value={ramzanHours}
              onChange={setRamzanHours}
              label="Working Hours (1–8)"
              id="ramzan-hours"
              type="number"
              placeholder="e.g. 6"
            />
            <p className="text-xs text-slate-400">
              {currentRamzanHours !== null ? `Currently set to ${currentRamzanHours}h.` : 'Not customized yet — defaults to 6h.'}
            </p>

            {periodError && (
              <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
                <XCircle className="h-4 w-4 shrink-0" />{periodError}
              </div>
            )}
            {periodSuccess && (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-200">
                <CheckCircle2 className="h-4 w-4 shrink-0" />Period declared and working hours saved.
              </div>
            )}

            <Button type="submit" disabled={periodSubmitting} className="w-full">
              {periodSubmitting ? (<><Loader2 className="h-4 w-4 animate-spin" /> Declaring…</>) : 'Declare Period'}
            </Button>
          </form>
        </Card>

        <Card className="p-6">
          <div className="mb-4 flex items-center gap-2">
            <Copy className="h-5 w-5 text-slate-400" />
            <h2 className="text-base font-semibold text-slate-900">Duplicate Punch Window</h2>
          </div>
          <p className="mb-4 text-sm text-slate-500">
            A second punch for the same employee and project within this many minutes of an existing one is
            flagged as a likely duplicate before it's added. Admins can still confirm and add it anyway.
          </p>

          <form onSubmit={handleDuplicateWindowSubmit} className="space-y-4">
            <Input
              value={duplicateWindow}
              onChange={setDuplicateWindow}
              label="Minutes (1–120)"
              id="duplicate-punch-window"
              type="number"
              placeholder="e.g. 5"
            />
            {currentDuplicateWindow !== null && (
              <p className="text-xs text-slate-400">Currently set to {currentDuplicateWindow} minute{currentDuplicateWindow === 1 ? '' : 's'}.</p>
            )}

            {duplicateWindowError && (
              <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
                <XCircle className="h-4 w-4 shrink-0" />{duplicateWindowError}
              </div>
            )}
            {duplicateWindowSuccess && (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-200">
                <CheckCircle2 className="h-4 w-4 shrink-0" />Saved.
              </div>
            )}

            <Button type="submit" disabled={duplicateWindowSubmitting} className="w-full">
              {duplicateWindowSubmitting ? (<><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>) : 'Save'}
            </Button>
          </form>
        </Card>

        <Card className="p-6">
          <div className="mb-4 flex items-center gap-2">
            <Siren className="h-5 w-5 text-slate-400" />
            <h2 className="text-base font-semibold text-slate-900">Emergency Time Allowance</h2>
          </div>
          <p className="mb-4 text-sm text-slate-500">
            The nightly window an employee can create a task for themselves directly from mobile, with no
            supervisor or backoffice involved. Outside this window, only a supervisor or backoffice can assign
            them work, as normal.
          </p>

          <form onSubmit={handleEmergencySubmit} className="space-y-4">
            {/* Stored and compared in UTC on the server (same convention as
                punch_time and every other clock-sensitive check in this
                app) — the plain <input type="time"> gives no timezone cue
                on its own, so both fields are explicitly labeled UTC and a
                live "your local time right now" readout is shown alongside
                it, to stop an admin from unknowingly entering their own
                local wall-clock time here. */}
            <div className="grid grid-cols-2 gap-3">
              <Input value={emergencyStart} onChange={setEmergencyStart} label="Start time (UTC)" id="emergency-start" type="time" lang="en-US" />
              <Input value={emergencyEnd} onChange={setEmergencyEnd} label="End time (UTC)" id="emergency-end" type="time" lang="en-US" />
            </div>
            <p className="text-xs text-slate-400">
              Currently {emergencyStart}–{emergencyEnd} UTC (crosses midnight if the end time is earlier than the start).
              Your local time right now is {nowLocalTime} ({nowUtcTime} UTC) — enter the window in UTC, not local time.
            </p>

            {emergencyError && (
              <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
                <XCircle className="h-4 w-4 shrink-0" />{emergencyError}
              </div>
            )}
            {emergencySuccess && (
              <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-200">
                <CheckCircle2 className="h-4 w-4 shrink-0" />Saved.
              </div>
            )}

            <Button type="submit" disabled={emergencySubmitting} className="w-full">
              {emergencySubmitting ? (<><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>) : 'Save'}
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
            {sortedPeriods.map((p) => {
              const declarer = employees.find((e) => e.emp_id === p.declared_by);
              const isPast = p.end_date < TODAY;
              const isActive = p.active && p.start_date <= TODAY && TODAY <= p.end_date;
              const statusLabel = !p.active ? 'Deactivated' : isActive ? 'Active now' : isPast ? 'Past' : 'Upcoming';
              const statusVariant = !p.active ? 'neutral' : isActive ? 'accent' : isPast ? 'neutral' : 'info';
              return (
                <div key={p.id} className="flex items-center justify-between gap-4 p-5">
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      {formatDate(p.start_date)} – {formatDate(p.end_date)}
                    </p>
                    <p className="mt-1 text-xs text-slate-400">
                      Declared by {declarer?.name ?? p.declared_by} · {formatDate(p.declared_at)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={statusVariant}>{statusLabel}</Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleActive(p)}
                      disabled={togglingPeriodId === p.id}
                      className="!px-2 !py-1"
                    >
                      {togglingPeriodId === p.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : p.active ? (
                        <PowerOff className="h-3.5 w-3.5" />
                      ) : (
                        <Power className="h-3.5 w-3.5" />
                      )}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => openEditPeriod(p)} className="!px-2 !py-1">
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => { setPeriodDeleteError(null); setDeletingPeriod(p); }}
                      className="!px-2 !py-1 text-rose-600 hover:bg-rose-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </Card>
        )}
      </div>

      <div className="mt-6">
        <Card className="border-rose-200 p-6">
          <div className="mb-2 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-rose-500" />
            <h2 className="text-base font-semibold text-slate-900">Danger Zone</h2>
          </div>
          <p className="mb-4 text-sm text-slate-500">
            Permanently deletes all {RESET_TABLES_LABEL} — every generated attendance activity, back to a clean
            slate. Employees, projects, and all other configuration are never touched. This cannot be undone.
          </p>

          {resetSuccess && (
            <div className="mb-4 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-200">
              <CheckCircle2 className="h-4 w-4 shrink-0" />Test data reset.
            </div>
          )}

          <Button variant="secondary" onClick={openResetConfirm} className="border border-rose-300 text-rose-700 hover:bg-rose-50">
            <Trash2 className="h-4 w-4" /> Reset Test Data
          </Button>
        </Card>
      </div>

      <Modal open={editingPeriod !== null} onClose={() => setEditingPeriod(null)} title="Edit Ramzan Period">
        <form onSubmit={handleEditSubmit} className="space-y-4">
          <Input value={editStartDate} onChange={setEditStartDate} label="Start Date" id="edit-ramzan-start" type="date" />
          <Input value={editEndDate} onChange={setEditEndDate} label="End Date" id="edit-ramzan-end" type="date" />
          <p className="text-xs text-slate-400">
            Editing doesn't retroactively change any confirmation-sheet rows or overtime approvals already
            generated for dates in this period — only reports generated after this edit reflect the new dates.
          </p>

          {editError && (
            <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
              <XCircle className="h-4 w-4 shrink-0" />{editError}
            </div>
          )}

          <div className="flex gap-3 pt-1">
            <Button type="button" variant="secondary" onClick={() => setEditingPeriod(null)} disabled={editSubmitting} className="flex-1">
              Cancel
            </Button>
            <Button type="submit" disabled={editSubmitting} className="flex-1">
              {editSubmitting ? (<><Loader2 className="h-4 w-4 animate-spin" /> Saving…</>) : 'Save Changes'}
            </Button>
          </div>
        </form>
      </Modal>

      <Modal open={deletingPeriod !== null} onClose={() => setDeletingPeriod(null)} title="Delete this Ramzan period?">
        <p className="mb-4 text-sm text-slate-600">
          {deletingPeriod && (
            <>This permanently removes the{' '}
              <span className="font-medium text-slate-900">{formatDate(deletingPeriod.start_date)} – {formatDate(deletingPeriod.end_date)}</span>
              {' '}period. Confirmation-sheet rows and overtime approvals already generated for dates inside it are not affected — only future
              report generation stops applying it. This cannot be undone.</>
          )}
        </p>

        {periodDeleteError && (
          <div className="mb-4 flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
            <XCircle className="h-4 w-4 shrink-0" />{periodDeleteError}
          </div>
        )}

        <div className="flex gap-3">
          <Button variant="secondary" onClick={() => setDeletingPeriod(null)} disabled={periodDeleting} className="flex-1">
            Cancel
          </Button>
          <Button
            onClick={handleConfirmDeletePeriod}
            disabled={periodDeleting}
            className="flex-1 bg-rose-600 hover:bg-rose-700 focus-visible:outline-rose-600"
          >
            {periodDeleting ? (<><Loader2 className="h-4 w-4 animate-spin" /> Deleting…</>) : (<><Trash2 className="h-4 w-4" /> Delete Period</>)}
          </Button>
        </div>
      </Modal>

      <Modal open={showResetConfirm} onClose={() => setShowResetConfirm(false)} title="Reset test data?">
        <p className="mb-4 text-sm text-slate-600">
          This permanently deletes all {RESET_TABLES_LABEL}. Employees, projects, and settings are not affected.
          This cannot be undone.
        </p>
        <p className="mb-2 text-sm font-medium text-slate-700">
          Type <span className="font-mono font-bold text-rose-700">RESET</span> to confirm.
        </p>
        <Input value={resetConfirmText} onChange={setResetConfirmText} id="reset-confirm-text" placeholder="RESET" />

        {resetError && (
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
            <XCircle className="h-4 w-4 shrink-0" />{resetError}
          </div>
        )}

        <div className="mt-5 flex gap-3">
          <Button variant="secondary" onClick={() => setShowResetConfirm(false)} disabled={resetting} className="flex-1">
            Cancel
          </Button>
          <Button
            onClick={handleConfirmReset}
            disabled={resetConfirmText !== 'RESET' || resetting}
            className="flex-1 bg-rose-600 hover:bg-rose-700 focus-visible:outline-rose-600"
          >
            {resetting ? (<><Loader2 className="h-4 w-4 animate-spin" /> Resetting…</>) : (<><Trash2 className="h-4 w-4" /> Delete Everything</>)}
          </Button>
        </div>
      </Modal>
    </div>
  );
}
