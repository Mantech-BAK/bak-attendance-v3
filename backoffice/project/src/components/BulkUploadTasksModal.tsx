import { useRef, useState } from 'react';
import { Upload, Download, Loader2, XCircle, CheckCircle2, AlertTriangle } from 'lucide-react';
import { uploadTasksBulk, tasksTemplateUrl, authHeaders, ApiError } from '@/lib/api';
import type { BulkTaskUploadResult } from '@/lib/api';
import { Modal, Button } from '@/components/ui';

// Bulk task creation from a filled-in copy of the downloadable template —
// partial success by design: every row is validated and attempted
// independently on the backend, so a bad row (unknown employee, inactive
// employee, bad project code, bad priority, duplicate, missing field)
// never blocks the good rows around it. This modal just uploads the file
// and renders whatever per-row result comes back.
export function BulkUploadTasksModal({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkTaskUploadResult | null>(null);

  function reset() {
    setFileName(null);
    setError(null);
    setResult(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function handleClose() {
    reset();
    onClose();
  }

  async function handleDownloadTemplate() {
    setDownloadingTemplate(true);
    try {
      const response = await fetch(tasksTemplateUrl(), { headers: authHeaders() });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || `Request failed (${response.status})`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'task-upload-template.xlsx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not download the template.');
    } finally {
      setDownloadingTemplate(false);
    }
  }

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    setError(null);
    setResult(null);
    setUploading(true);
    try {
      const uploadResult = await uploadTasksBulk(file);
      setResult(uploadResult);
      if (uploadResult.created.length > 0) onSuccess();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not upload the file. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  return (
    <Modal open={open} onClose={handleClose} title="Upload Tasks">
      <div className="space-y-4">
        <p className="text-sm text-slate-500">
          Download the template, fill in one row per task, then upload it here. Every row is validated and created
          independently — a problem with one row won't block the rest of the file.
        </p>

        <Button variant="secondary" onClick={handleDownloadTemplate} disabled={downloadingTemplate} className="w-full">
          {downloadingTemplate ? (<><Loader2 className="h-4 w-4 animate-spin" /> Downloading…</>) : (<><Download className="h-4 w-4" /> Download Template</>)}
        </Button>

        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx"
            onChange={handleFileChange}
            className="hidden"
            id="bulk-upload-file"
          />
          <Button onClick={() => fileInputRef.current?.click()} disabled={uploading} className="w-full">
            {uploading ? (<><Loader2 className="h-4 w-4 animate-spin" /> Uploading…</>) : (<><Upload className="h-4 w-4" /> {fileName ? 'Choose a Different File' : 'Choose File & Upload'}</>)}
          </Button>
          {fileName && !uploading && (
            <p className="mt-1.5 truncate text-xs text-slate-400">{fileName}</p>
          )}
        </div>

        {error && (
          <div className="flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
            <XCircle className="h-4 w-4 shrink-0" />{error}
          </div>
        )}

        {result && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700 ring-1 ring-inset ring-emerald-200">
              <CheckCircle2 className="h-4 w-4 shrink-0" />
              {result.created.length} of {result.totalRows} task{result.totalRows === 1 ? '' : 's'} created.
            </div>

            {result.errors.length > 0 && (
              <div className="rounded-lg bg-rose-50 p-3 ring-1 ring-inset ring-rose-200">
                <div className="mb-2 flex items-center gap-2 text-sm font-medium text-rose-700">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  {result.errors.length} row{result.errors.length === 1 ? '' : 's'} rejected
                </div>
                <div className="max-h-56 space-y-1.5 overflow-y-auto pr-1">
                  {result.errors.map((e, i) => (
                    <div key={i} className="rounded-md bg-white px-2.5 py-2 text-xs text-rose-700 ring-1 ring-inset ring-rose-100">
                      <span className="font-semibold">Row {e.row}</span>
                      {e.emp_id && e.emp_id !== 'UNKNOWN' ? ` (${e.emp_id})` : ''}: {e.reason}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <Button variant="secondary" onClick={handleClose} className="w-full">
          {result ? 'Done' : 'Cancel'}
        </Button>
      </div>
    </Modal>
  );
}
