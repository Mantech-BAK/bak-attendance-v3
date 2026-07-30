import { useState } from 'react';
import { FileSpreadsheet, Download, Loader2, XCircle } from 'lucide-react';
import { confirmationSheetUrl } from '@/lib/api';
import { PageHeader } from '@/components/PageHeader';
import { Card, Button, Input } from '@/components/ui';

function yesterday(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

// Generated on-demand only — never automatically pushed anywhere. Fetched
// as a blob (rather than a plain <a href> link) so a server-side error
// shows inline instead of downloading as a mystery file.
export function ConfirmationSheetPage() {
  const [date, setDate] = useState(yesterday());
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDownload() {
    setError(null);
    setDownloading(true);
    try {
      const response = await fetch(confirmationSheetUrl(date));
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.error || `Request failed (${response.status})`);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `confirmation-sheet-${date}.xlsx`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate the report.');
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Confirmation Sheet"
        subtitle="Daily attendance confirmation sheet, generated on-demand — never pushed automatically anywhere."
      />

      <Card className="max-w-xl p-6">
        <div className="mb-4 flex items-center gap-2">
          <FileSpreadsheet className="h-5 w-5 text-slate-400" />
          <h2 className="text-base font-semibold text-slate-900">Generate Report</h2>
        </div>

        <Input value={date} onChange={setDate} label="Attendance Date" id="confirmation-date" type="date" />

        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-lg bg-rose-50 px-3 py-2.5 text-sm text-rose-700 ring-1 ring-inset ring-rose-200">
            <XCircle className="h-4 w-4 shrink-0" />{error}
          </div>
        )}

        <Button onClick={handleDownload} disabled={downloading || !date} className="mt-5 w-full">
          {downloading ? (
            <><Loader2 className="h-4 w-4 animate-spin" /> Generating…</>
          ) : (
            <><Download className="h-4 w-4" /> Download Confirmation Sheet</>
          )}
        </Button>
      </Card>
    </div>
  );
}
