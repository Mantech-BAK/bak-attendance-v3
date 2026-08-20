const ExcelJS = require('exceljs');
const { getSetting } = require('./settings');

const COLUMNS = [
  { header: '#', key: 'rowNumber', width: 6 },
  { header: 'EMP ID', key: 'emp_id', width: 10 },
  { header: 'EMPLOYEE NAME', key: 'employee_name', width: 22 },
  { header: 'DESIGNATION', key: 'designation', width: 20 },
  { header: 'COST CENTER', key: 'cost_center', width: 14 },
  { header: 'ATTENDANCE DATE', key: 'attendance_date', width: 16 },
  { header: 'START DATE', key: 'start_date', width: 14 },
  { header: 'START TIME', key: 'start_time', width: 12 },
  { header: 'END TIME', key: 'end_time', width: 12 },
  { header: 'END DATE', key: 'end_date', width: 14 },
  { header: 'T. WORKING H.', key: 'working_hours', width: 14 },
  { header: 'JOB', key: 'job', width: 12 },
  { header: 'PROJECT NAME', key: 'project_name', width: 28 },
  { header: 'REMARKS', key: 'remarks', width: 44 },
  { header: 'OT ELIGIBLE', key: 'ot_eligible', width: 12 },
  { header: 'OT', key: 'ot', width: 10 },
  { header: 'APPROVAL REQUIRED', key: 'approval_required', width: 18 },
];

// dateKey()/getUtcDayBounds() use UTC internally purely as an arithmetic
// convention for day-bucketing punches consistently through node-pg's
// timestamp-without-tz round-trip — it says nothing about what clock time a
// human should see. A human reading this report needs the actual local
// wall-clock time the punch happened at (BAK's operating timezone), not the
// UTC-instant reading — displaying raw UTC here made every punch appear
// ~3 hours earlier than it really was, so real varied punch times (e.g.
// shift starts clustered around 9am local) all showed up clustered near
// 6am, looking like uniform placeholder data. timeZone must stay explicit
// (never left to toLocaleTimeString's host-timezone default), just pinned
// to the business's real zone instead of UTC.
const REPORT_TIME_ZONE = 'Asia/Riyadh';

function formatTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: REPORT_TIME_ZONE });
}

async function buildConfirmationSheetWorkbook(date, rows) {
  const [isoRefNo, isoVersion, isoDate, maxOtMinutes] = await Promise.all([
    getSetting('iso_ref_no'),
    getSetting('iso_version'),
    getSetting('iso_date'),
    getSetting('max_ot_minutes'),
  ]);

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Confirmation Sheet');

  sheet.mergeCells('A1:D1');
  sheet.getCell('A1').value = 'BAK Attendance Confirmation Sheet';
  sheet.getCell('A1').font = { bold: true, size: 14 };

  sheet.getCell('A2').value = 'ISO Ref No.:';
  sheet.getCell('B2').value = isoRefNo;
  sheet.getCell('C2').value = 'ISO Version:';
  sheet.getCell('D2').value = isoVersion;
  sheet.getCell('A3').value = 'ISO Date:';
  sheet.getCell('B3').value = isoDate;
  sheet.getCell('C3').value = 'Max OT (hrs):';
  sheet.getCell('D3').value = maxOtMinutes ? Number(maxOtMinutes) / 60 : '';
  sheet.getCell('A4').value = 'Report Date:';
  sheet.getCell('B4').value = date;
  ['A2', 'C2', 'A3', 'C3', 'A4'].forEach((ref) => {
    sheet.getCell(ref).font = { bold: true };
  });

  const headerRowIndex = 6;
  const headerRow = sheet.getRow(headerRowIndex);
  headerRow.values = COLUMNS.map((c) => c.header);
  headerRow.font = { bold: true };
  headerRow.eachCell((cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } };
    cell.border = { bottom: { style: 'thin' } };
  });
  COLUMNS.forEach((col, i) => {
    sheet.getColumn(i + 1).width = col.width;
  });

  for (const row of rows) {
    sheet.addRow(
      COLUMNS.map((col) => {
        if (col.key === 'start_time' || col.key === 'end_time') {
          return formatTime(row[col.key]);
        }
        return row[col.key] ?? '';
      })
    );
  }

  return workbook;
}

module.exports = { buildConfirmationSheetWorkbook };
