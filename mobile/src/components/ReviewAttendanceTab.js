import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import OvertimeApprovalsCard from './OvertimeApprovalsCard';

// Create Task and Scan Team Member used to be buttons at the bottom of this
// panel — they're now their own separate tabs, so this is just the pending-
// approvals list, plus a separate Overtime Approvals card below it (OT is a
// distinct, day-level concept from per-punch approval, not bundled in).
export default function ReviewAttendanceTab({
  pendingApprovals,
  loadingApprovals,
  onApprove,
  onReject,
  processingId,
  pendingOtApprovals,
  loadingOt,
  onApproveOt,
  onRejectOt,
  processingOtId,
}) {
  return (
    <View>
      <View style={styles.container}>
        <View style={styles.headingRow}>
          <Ionicons name="checkbox-outline" size={18} color="#111827" />
          <Text style={styles.heading}>Team Punch Approvals</Text>
        </View>

        {loadingApprovals ? (
          <ActivityIndicator style={styles.spinner} />
        ) : pendingApprovals.length === 0 ? (
          <View style={styles.emptyRow}>
            <Ionicons name="checkmark-done-circle-outline" size={16} color="#9ca3af" />
            <Text style={styles.empty}>No pending approvals</Text>
          </View>
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

      <OvertimeApprovalsCard
        pendingOtApprovals={pendingOtApprovals}
        loadingOt={loadingOt}
        onApprove={onApproveOt}
        onReject={onRejectOt}
        processingId={processingOtId}
      />
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
  approvalActions: { flexDirection: 'row', gap: 8 },
  smallButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 6 },
  approveButton: { backgroundColor: '#16a34a' },
  rejectButton: { backgroundColor: '#dc2626' },
  smallButtonText: { color: '#fff', fontSize: 13, fontWeight: '600' },
});
