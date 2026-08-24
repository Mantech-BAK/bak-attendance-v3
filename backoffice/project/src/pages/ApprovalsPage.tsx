import { useEffect, useState } from 'react';
import { Clock, Timer, CheckCircle2, XCircle, Loader2, Inbox } from 'lucide-react';
import {
  fetchAllPendingPunches,
  approvePunchAdmin,
  rejectPunchAdmin,
  fetchAllPendingOtApprovals,
  approveOtApprovalAdmin,
  rejectOtApprovalAdmin,
  ApiError,
} from '@/lib/api';
import type { PendingPunch, OtApproval } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Card, Button, Badge, EmptyState, Spinner, Modal, Textarea } from '@/components/ui';
import { formatDateTime, formatDate } from '@/lib/utils';

// Item 3 — company-wide approval, straight from the backoffice, using the
// exact same endpoints the mobile supervisor Review Attendance tab already
// calls (see fetchAllPendingPunches/approvePunchAdmin/etc. in lib/api.ts) —
// the backend resolves this session's own Bearer token into a company-wide
// scope and a bypass of the "must be this employee's reporting manager"
// check that mobile's flow is still held to.
type RejectTarget = { kind: 'punch' | 'ot'; id: number; label: string } | null;

export function ApprovalsPage() {
  const [loading, setLoading] = useState(true);
  const [punches, setPunches] = useState<PendingPunch[]>([]);
  const [otApprovals, setOtApprovals] = useState<OtApproval[]>([]);
  const [processingId, setProcessingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [rejectTarget, setRejectTarget] = useState<RejectTarget>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejecting, setRejecting] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);

  useEffect(() => {
    load();
  }, []);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [p, o] = await Promise.all([fetchAllPendingPunches(), fetchAllPendingOtApprovals()]);
      setPunches(p);
      setOtApprovals(o);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load pending approvals.');
    } finally {
      setLoading(false);
    }
  }

  async function handleApprovePunch(id: number) {
    setProcessingId(`punch:${id}`);
    setError(null);
    try {
      await approvePunchAdmin(id);
      setPunches((prev) => prev.filter((p) => p.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not approve the punch. Please try again.');
    } finally {
      setProcessingId(null);
    }
  }

  async function handleApproveOt(id: number) {
    setProcessingId(`ot:${id}`);
    setError(null);
    try {
      await approveOtApprovalAdmin(id);
      setOtApprovals((prev) => prev.filter((o) => o.id !== id));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not approve the OT request. Please try again.');
    } finally {
      setProcessingId(null);
    }
  }

  function openReject(kind: 'punch' | 'ot', id: number, label: string) {
    setRejectTarget({ kind, id, label });
    setRejectReason('');
    setRejectError(null);
  }

  async function handleConfirmReject() {
    if (!rejectTarget) return;
    if (!rejectReason.trim()) {
      setRejectError('A reason is required.');
      return;
    }
    setRejecting(true);
    setRejectError(null);
    try {
      if (rejectTarget.kind === 'punch') {
        await rejectPunchAdmin(rejectTarget.id, rejectReason.trim());
        setPunches((prev) => prev.filter((p) => p.id !== rejectTarget.id));
      } else {
        await rejectOtApprovalAdmin(rejectTarget.id, rejectReason.trim());
        setOtApprovals((prev) => prev.filter((o) => o.id !== rejectTarget.id));
      }
      setRejectTarget(null);
    } catch (err) {
      setRejectError(err instanceof ApiError ? err.message : 'Could not reject. Please try again.');
    } finally {
      setRejecting(false);
    }
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Approvals" subtitle="Punches and overtime awaiting review, company-wide." />
        <Spinner />
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Approvals" subtitle="Punches and overtime awaiting review, company-wide." />

      {error && (
        <div className="mb-6 flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
          <XCircle className="h-4 w-4 shrink-0" />{error}
        </div>
      )}

      <div className="space-y-8">
        <div>
          <div className="mb-4 flex items-center gap-2">
            <Clock className="h-5 w-5 text-slate-400" />
            <h2 className="text-base font-semibold text-slate-900">Pending Punches</h2>
            <Badge variant="neutral">{punches.length}</Badge>
          </div>

          {punches.length === 0 ? (
            <Card className="p-6">
              <EmptyState icon={<Inbox className="h-6 w-6" />} title="Nothing pending" message="Every punch has been reviewed." />
            </Card>
          ) : (
            <Card className="divide-y divide-slate-100">
              {punches.map((p) => (
                <div key={p.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{p.employee_name ?? p.emp_id}</p>
                    <p className="text-xs text-slate-500">
                      {p.task_display_id ? `${p.task_display_id} — ` : ''}{p.project_name ?? p.project_code ?? 'No project'} · {formatDateTime(p.punch_time)}
                    </p>
                    <p className="text-xs text-slate-400">Entered by {p.entered_by} ({p.entry_method})</p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleApprovePunch(p.id)}
                      disabled={processingId === `punch:${p.id}`}
                      className="!bg-emerald-600 hover:!bg-emerald-700"
                    >
                      {processingId === `punch:${p.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => openReject('punch', p.id, `${p.employee_name ?? p.emp_id}'s punch`)}
                      disabled={processingId === `punch:${p.id}`}
                      className="!text-rose-600"
                    >
                      <XCircle className="h-4 w-4" />
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </div>

        <div>
          <div className="mb-4 flex items-center gap-2">
            <Timer className="h-5 w-5 text-slate-400" />
            <h2 className="text-base font-semibold text-slate-900">Pending Overtime</h2>
            <Badge variant="neutral">{otApprovals.length}</Badge>
          </div>

          {otApprovals.length === 0 ? (
            <Card className="p-6">
              <EmptyState icon={<Inbox className="h-6 w-6" />} title="Nothing pending" message="Every overtime request has been reviewed." />
            </Card>
          ) : (
            <Card className="divide-y divide-slate-100">
              {otApprovals.map((o) => (
                <div key={o.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                  <div>
                    <p className="text-sm font-medium text-slate-900">{o.employee_name}</p>
                    <p className="text-xs text-slate-500">
                      {formatDate(o.work_date)} · worked {Math.round(o.worked_minutes / 60 * 10) / 10}h, threshold {Math.round(o.threshold_minutes / 60 * 10) / 10}h — {Math.round(o.ot_minutes / 60 * 10) / 10}h OT
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={() => handleApproveOt(o.id)}
                      disabled={processingId === `ot:${o.id}`}
                      className="!bg-emerald-600 hover:!bg-emerald-700"
                    >
                      {processingId === `ot:${o.id}` ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => openReject('ot', o.id, `${o.employee_name}'s overtime request`)}
                      disabled={processingId === `ot:${o.id}`}
                      className="!text-rose-600"
                    >
                      <XCircle className="h-4 w-4" />
                      Reject
                    </Button>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </div>
      </div>

      <Modal open={rejectTarget !== null} onClose={() => setRejectTarget(null)} title="Reject">
        <div className="space-y-4">
          <p className="text-sm text-slate-600">Rejecting {rejectTarget?.label}. A reason is required.</p>
          <Textarea value={rejectReason} onChange={setRejectReason} label="Reason" id="reject-reason" placeholder="Why is this being rejected?" />
          {rejectError && (
            <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
              <XCircle className="h-4 w-4 shrink-0" />{rejectError}
            </div>
          )}
          <div className="flex gap-3 pt-1">
            <Button type="button" variant="secondary" onClick={() => setRejectTarget(null)} disabled={rejecting} className="flex-1">
              Cancel
            </Button>
            <Button type="button" onClick={handleConfirmReject} disabled={rejecting} className="flex-1 !bg-rose-600 hover:!bg-rose-700">
              {rejecting ? (<><Loader2 className="h-4 w-4 animate-spin" /> Rejecting…</>) : 'Reject'}
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
