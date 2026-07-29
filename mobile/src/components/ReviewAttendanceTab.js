import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

// Create Task and Scan Team Member used to be buttons at the bottom of this
// panel — they're now their own separate tabs, so this is just the pending-
// approvals list.
export default function ReviewAttendanceTab({ pendingApprovals, loadingApprovals, onApprove, onReject, processingId }) {
  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Team Punch Approvals</Text>

      {loadingApprovals ? (
        <ActivityIndicator style={styles.spinner} />
      ) : pendingApprovals.length === 0 ? (
        <Text style={styles.empty}>No pending approvals</Text>
      ) : (
        pendingApprovals.map((item) => (
          <View key={item.id} style={styles.approvalRow}>
            <View style={styles.approvalInfo}>
              <Text style={styles.approvalName}>{item.employee_name}</Text>
              <Text style={styles.approvalMeta}>
                {item.project_code || 'No project'} · {new Date(item.punch_time).toLocaleTimeString()}
              </Text>
            </View>
            <View style={styles.approvalActions}>
              <TouchableOpacity
                style={[styles.smallButton, styles.approveButton]}
                onPress={() => onApprove(item.id)}
                disabled={processingId === item.id}
              >
                <Text style={styles.smallButtonText}>Approve</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.smallButton, styles.rejectButton]}
                onPress={() => onReject(item.id)}
                disabled={processingId === item.id}
              >
                <Text style={styles.smallButtonText}>Reject</Text>
              </TouchableOpacity>
            </View>
          </View>
        ))
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
  },
  heading: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 10 },
  spinner: { marginVertical: 12 },
  empty: { color: '#9ca3af', fontStyle: 'italic', marginBottom: 8 },
  approvalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  approvalInfo: { flex: 1 },
  approvalName: { fontSize: 15, fontWeight: '600', color: '#111827' },
  approvalMeta: { fontSize: 12, color: '#6b7280', marginTop: 2 },
  approvalActions: { flexDirection: 'row', gap: 8 },
  smallButton: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
  approveButton: { backgroundColor: '#16a34a' },
  rejectButton: { backgroundColor: '#dc2626' },
  smallButtonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
