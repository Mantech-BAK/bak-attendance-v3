import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const STATUS_COLORS = {
  approved: { bg: '#dcfce7', text: '#15803d', icon: 'checkmark-circle' },
  pending: { bg: '#fef3c7', text: '#b45309', icon: 'time' },
  rejected: { bg: '#fee2e2', text: '#b91c1c', icon: 'close-circle' },
};

// Own-vs-team-member accent (a left border, not a background tint, so it
// doesn't fight with the approval-status badge's own colors) — the
// approval status and the own/team distinction are two independent
// dimensions of the same row, not one replacing the other.
const OWN_ACCENT = '#2563eb';
const TEAM_ACCENT = '#7c3aed';

// Read-only — no approve/reject action here, that's still the Review
// Attendance tab. Backs BOTH a supervisor's Punch History (their own punches
// plus their team's, color-distinguished) and a plain employee's Punch
// History (always just their own, so every row shares the same accent and
// showLegend should be left off) — the backend's GET /api/punches/history
// already scopes the rows correctly per viewer; this component only needs
// to tell "mine" from "theirs" for coloring.
//
// Deliberately never labels an individual punch "Open"/"Close" — every
// entry just says "Punched" regardless of whether it was the task's first
// or second punch.
export default function PunchHistoryTab({ history, loading, viewerEmpId, heading = 'Punch History', showLegend = false }) {
  return (
    <View style={styles.container}>
      <View style={styles.headingRow}>
        <Ionicons name="time-outline" size={18} color="#111827" />
        <Text style={styles.heading}>{heading}</Text>
      </View>

      {showLegend && (
        <View style={styles.legendRow}>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: OWN_ACCENT }]} />
            <Text style={styles.legendText}>You</Text>
          </View>
          <View style={styles.legendItem}>
            <View style={[styles.legendDot, { backgroundColor: TEAM_ACCENT }]} />
            <Text style={styles.legendText}>Team</Text>
          </View>
        </View>
      )}

      {loading ? (
        <ActivityIndicator style={styles.spinner} />
      ) : !history || history.length === 0 ? (
        <View style={styles.emptyRow}>
          <Ionicons name="file-tray-outline" size={16} color="#9ca3af" />
          <Text style={styles.empty}>No punches recorded yet</Text>
        </View>
      ) : (
        history.map((item) => {
          const colors = STATUS_COLORS[item.approval_status] || STATUS_COLORS.pending;
          const isOwn = item.emp_id === viewerEmpId;
          return (
            <View key={item.id} style={[styles.row, { borderLeftColor: isOwn ? OWN_ACCENT : TEAM_ACCENT }]}>
              <View style={styles.info}>
                <Text style={styles.name}>{isOwn ? 'You' : item.employee_name}</Text>
                <Text style={styles.meta}>
                  {item.task_display_id ? `${item.task_display_id} — ` : ''}
                  {item.project_name || item.project_code || 'No project'} · Punched {new Date(item.punch_time).toLocaleString()}
                </Text>
                <Text style={styles.meta}>
                  {item.entry_method === 'self' ? 'Self punch' : `Entered by ${item.entered_by}`}
                  {item.approval_status === 'rejected' && item.rejection_reason ? ` · ${item.rejection_reason}` : ''}
                </Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: colors.bg }]}>
                <Ionicons name={colors.icon} size={12} color={colors.text} />
                <Text style={[styles.statusText, { color: colors.text }]}>{item.approval_status}</Text>
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', backgroundColor: '#fff', borderRadius: 12, padding: 16 },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  heading: { fontSize: 16, fontWeight: '700', color: '#111827' },
  legendRow: { flexDirection: 'row', gap: 16, marginBottom: 10 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  legendDot: { width: 8, height: 8, borderRadius: 4 },
  legendText: { fontSize: 12, color: '#6b7280', fontWeight: '600' },
  spinner: { marginVertical: 12 },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  empty: { color: '#9ca3af', fontStyle: 'italic' },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    paddingLeft: 10,
    borderLeftWidth: 3,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    gap: 8,
  },
  info: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600', color: '#111827' },
  meta: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  statusBadge: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusText: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
});
