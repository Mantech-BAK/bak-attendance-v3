/**
 * STUB — replace with real Microsoft Graph calls once the Graph API
 * permission for the designated Teams channel is granted. Cannot be
 * live-tested against real Teams yet, so this returns realistic simulated
 * channel messages instead, in the same shape Graph's chatMessage resource
 * would provide (id, channelId, sender, createdDateTime, body).
 *
 * Admins paste multiple copied spreadsheet rows into the channel as one
 * message. Teams normally converts a real Excel-cell paste into an HTML
 * table in the message body; a plain-text paste (e.g. from a CSV file)
 * comes through as comma-separated lines instead — both shapes are
 * represented below.
 */

const AUTHORIZED_SENDER_EMAIL = 'supervisor@bakgroup.net';
const UNAUTHORIZED_SENDER_EMAIL = 'random.employee@bakgroup.net';

const FAKE_MESSAGES = [
  {
    // Valid HTML table paste, with a header row, containing 2 valid rows
    // and 1 invalid row (unknown project code) — exercises the mixed
    // valid/invalid batch + header-row detection.
    id: 'msg-1001',
    channelId: 'channel-test-001',
    from: { email: AUTHORIZED_SENDER_EMAIL },
    createdDateTime: '2026-07-29T06:00:00.000Z',
    body: {
      contentType: 'html',
      content: `<table>
        <tr><td>Employee ID</td><td>Task Date</td><td>Project Code</td><td>Priority</td><td>Description</td><td>Location</td></tr>
        <tr><td>E1002</td><td>2026-08-01</td><td>PRJ-001</td><td>high</td><td>Inspect warehouse racking</td><td>Dock 2</td></tr>
        <tr><td>E1003</td><td>2026-08-02</td><td>PRJ-999</td><td>medium</td><td>Check fleet telemetry unit</td><td>Yard B</td></tr>
        <tr><td>E1004</td><td>2026-08-01</td><td>PRJ-002</td><td>low</td><td>Restock spare parts shelf</td><td>Warehouse A</td></tr>
      </table>`,
    },
  },
  {
    // Plain-text fallback (pasted from a CSV, not real Excel cells) —
    // comma-separated, no header row, single valid row.
    id: 'msg-1002',
    channelId: 'channel-test-001',
    from: { email: AUTHORIZED_SENDER_EMAIL },
    createdDateTime: '2026-07-29T06:05:00.000Z',
    body: {
      contentType: 'text',
      content: 'E1002,2026-08-03,PRJ-001,medium,Weekly generator check,Site B',
    },
  },
  {
    // From someone other than the authorized sender — must be silently
    // ignored in its entirety, never parsed or replied to.
    id: 'msg-1003',
    channelId: 'channel-test-001',
    from: { email: UNAUTHORIZED_SENDER_EMAIL },
    createdDateTime: '2026-07-29T06:10:00.000Z',
    body: {
      contentType: 'text',
      content: 'E1001,2026-08-04,PRJ-001,high,This should never be processed,Nowhere',
    },
  },
  {
    // Authorized sender, but the row has no Employee ID at all — exercises
    // the UNKNOWN placeholder path.
    id: 'msg-1004',
    channelId: 'channel-test-001',
    from: { email: AUTHORIZED_SENDER_EMAIL },
    createdDateTime: '2026-07-29T06:15:00.000Z',
    body: {
      contentType: 'html',
      content: `<table>
        <tr><td></td><td>2026-08-05</td><td>PRJ-001</td><td>low</td><td>Unattributed task row</td><td></td></tr>
      </table>`,
    },
  },
];

/**
 * STUB — returns simulated messages created after sinceIso, oldest first,
 * mirroring how a real delta/watermark query against Graph would behave.
 */
async function fetchChannelMessages(sinceIso) {
  // Simulate network latency of a real API call.
  await new Promise((resolve) => setTimeout(resolve, 50));

  return FAKE_MESSAGES
    .filter((msg) => msg.createdDateTime > sinceIso)
    .sort((a, b) => (a.createdDateTime < b.createdDateTime ? -1 : 1));
}

/**
 * STUB — can't actually post to Teams until Graph API access is granted.
 * Logs what would have been sent and returns it so callers/tests can
 * assert on it, instead of silently doing nothing.
 */
async function postReplyToThread(channelId, messageId, text) {
  console.warn(`[teamsClient] SIMULATED reply to channel=${channelId} message=${messageId}:\n${text}`);
  return { simulated: true, channelId, messageId, text };
}

module.exports = { fetchChannelMessages, postReplyToThread };
