// Column order for a pasted row — Employee ID, Task Date, Project Code,
// Priority, Description, Location. Project Name is deliberately not a
// column here: it's never typed by the sender, always re-derived from
// Project Code by the same createTask() validation every other task-
// creation path uses.
const COLUMNS = ['emp_id', 'task_date', 'project_code', 'priority', 'description', 'location_site'];
const HEADER_FIRST_CELL = 'employee id';
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function decodeEntities(str) {
  return str
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'");
}

// Deliberately a small regex-based extractor, not a full HTML parser
// dependency — Teams' pasted-table markup is simple/predictable (<tr>/<td>
// or <th> only), matching this project's existing preference for minimal
// dependencies (built-in fetch over node-fetch, node:test over jest).
function extractRowsFromHtml(html) {
  const rows = [];
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  let trMatch;
  while ((trMatch = trRegex.exec(html)) !== null) {
    const cells = [];
    const cellRegex = /<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi;
    let cellMatch;
    while ((cellMatch = cellRegex.exec(trMatch[1])) !== null) {
      cells.push(decodeEntities(cellMatch[1].replace(/<[^>]*>/g, '')).trim());
    }
    if (cells.length > 0) rows.push(cells);
  }
  return rows;
}

// Fallback for plain-text pastes (e.g. copied from a CSV file rather than
// real Excel cells) — comma-separated, one row per line.
function extractRowsFromPlainText(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.split(',').map((cell) => cell.trim()));
}

function maybeSkipHeaderRow(rows) {
  if (rows.length === 0) return rows;
  const firstCell = (rows[0][0] || '').trim().toLowerCase();
  return firstCell === HEADER_FIRST_CELL ? rows.slice(1) : rows;
}

function parseMessageRows(message) {
  const content = message.body?.content || '';
  const isHtml = message.body?.contentType === 'html' || /<table/i.test(content);
  const rawRows = isHtml ? extractRowsFromHtml(content) : extractRowsFromPlainText(content);
  return maybeSkipHeaderRow(rawRows);
}

/**
 * Validates one parsed row against known employees/projects. Pure — takes
 * Sets of valid IDs rather than touching the DB itself, so the row-level
 * rules stay testable independent of data setup.
 */
function validateRow(cells, { employeeIds, projectCodes }) {
  const empIdGuess = (cells[0] || '').trim() || 'UNKNOWN';

  if (cells.length !== COLUMNS.length) {
    return { valid: false, empId: empIdGuess, reason: `row does not have the expected ${COLUMNS.length} columns` };
  }

  const [empId, taskDate, projectCode, priority, description, locationSite] = cells.map((cell) => cell.trim());

  if (!empId) {
    return { valid: false, empId: 'UNKNOWN', reason: 'employee ID is required' };
  }
  if (!employeeIds.has(empId)) {
    return { valid: false, empId, reason: `employee ${empId} not found` };
  }
  if (!taskDate || !DATE_PATTERN.test(taskDate)) {
    return { valid: false, empId, reason: 'task date must be in YYYY-MM-DD format' };
  }
  if (!projectCode) {
    return { valid: false, empId, reason: 'project code is required' };
  }
  if (!projectCodes.has(projectCode)) {
    return { valid: false, empId, reason: `project ${projectCode} not found` };
  }
  if (!description) {
    return { valid: false, empId, reason: 'description is required' };
  }

  return {
    valid: true,
    task: {
      emp_id: empId,
      taskDate,
      project_code: projectCode,
      priority: priority || null,
      description,
      location_site: locationSite || null,
    },
  };
}

module.exports = { parseMessageRows, validateRow, COLUMNS };
