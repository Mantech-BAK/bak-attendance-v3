import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

function formatHours(minutes) {
  return (minutes / 60).toFixed(1);
}

// A distinct card from Team Punch Approvals — OT is a day-level total
// computed separately (nightly job or on-demand confirmation-sheet
// generation), not a per-punch approval, so it's deliberately not bundled
// into that list.
export default function OvertimeApprovalsCard({ pendingOtApprovals, loadingOt, onApprove, onReject, processingId }) {
  return (
    <View style={styles.container}>
      <View style={styles.headingRow}>
        <Ionicons name="timer-outline" size={18} color="#111827" />
        <Text style={styles.heading}>Overtime Approvals</Text>
      </View>

      {loadingOt ? (
        <ActivityIndicator style={styles.spinner} />
      ) : pendingOtApprovals.length === 0 ? (
        <View style={styles.emptyRow}>
          <Ionicons name="checkmark-done-circle-outline" size={16} color="#9ca3af" />
          <Text style={styles.empty}>No pending overtime</Text>
        </View>
      ) : (
        pendingOtApprovals.map((item) => (
          <View key={item.id} style={styles.approvalRow}>
            <View style={styles.approvalInfo}>
              <Text style={styles.approvalName}>{item.employee_name}</Text>
              <Text style={styles.approvalMeta}>
                {item.work_date} · worked {formatHours(item.worked_minutes)}h of {formatHours(item.threshold_minutes)}h required
              </Text>
              <View style={styles.otAmountRow}>
                <Ionicons name="flash" size={12} color="#b45309" />
                <Text style={styles.otAmount}>+{formatHours(item.ot_minutes)}h overtime</Text>
              </View>
            </View>
            <View style={styles.approvalActions}>
              <TouchableOpacity
                style={[styles.smallButton, styles.approveButton]}
                onPress={() => onApprove(item.id)}
                disabled={processingId === item.id}
              >
                <Ionicons name="checkmark" size={14} color="#fff" />
                <Text style={styles.smallButtonText}>Approve</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.smallButton, styles.rejectButton]}
                onPress={() => onReject(item.id)}
                disabled={processingId === item.id}
              >
                <Ionicons name="close" size={14} color="#fff" />
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
    marginTop: 16,
  },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  heading: { fontSize: 16, fontWeight: '700', color: '#111827' },
  spinner: { marginVertical: 12 },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  empty: { color: '#9ca3af', fontStyle: 'italic' },
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
  otAmountRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  otAmount: { fontSize: 13, fontWeight: '700', color: '#b45309' },
  approvalActions: { flexDirection: 'row', gap: 8 },
  smallButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
  approveButton: { backgroundColor: '#16a34a' },
  rejectButton: { backgroundColor: '#dc2626' },
  smallButtonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
