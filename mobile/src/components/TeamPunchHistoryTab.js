import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

const STATUS_COLORS = {
  approved: { bg: '#dcfce7', text: '#15803d' },
  pending: { bg: '#fef3c7', text: '#b45309' },
  rejected: { bg: '#fee2e2', text: '#b91c1c' },
};

// Read-only — no approve/reject action here, that's still the Review
// Attendance tab. This is purely a viewing history of the team's punches
// (any status), most recent first (item 11).
export default function TeamPunchHistoryTab({ history, loading }) {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Team Punch History</Text>

      {loading ? (
        <ActivityIndicator style={styles.spinner} />
      ) : history.length === 0 ? (
        <Text style={styles.empty}>No punches recorded yet</Text>
      ) : (
        history.map((item) => {
          const colors = STATUS_COLORS[item.approval_status] || STATUS_COLORS.pending;
          return (
            <View key={item.id} style={styles.row}>
              <View style={styles.info}>
                <Text style={styles.name}>{item.employee_name}</Text>
                <Text style={styles.meta}>
                  {item.project_name || item.project_code || 'No project'} · {new Date(item.punch_time).toLocaleString()}
                </Text>
                <Text style={styles.meta}>
                  {item.entry_method === 'self' ? 'Self punch' : `Entered by ${item.entered_by}`}
                  {item.approval_status === 'rejected' && item.rejection_reason ? ` · ${item.rejection_reason}` : ''}
                </Text>
              </View>
              <View style={[styles.statusBadge, { backgroundColor: colors.bg }]}>
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
  heading: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 10 },
  spinner: { marginVertical: 12 },
  empty: { color: '#9ca3af', fontStyle: 'italic', marginBottom: 8 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
    gap: 8,
  },
  info: { flex: 1 },
  name: { fontSize: 15, fontWeight: '600', color: '#111827' },
  meta: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusText: { fontSize: 12, fontWeight: '700', textTransform: 'capitalize' },
});
