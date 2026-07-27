import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function SupervisorPanel({
  pendingApprovals,
  loadingApprovals,
  onApprove,
  onReject,
  onCreateTask,
  onScanTeamMember,
  processingId,
}) {
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

      <TouchableOpacity style={styles.createTaskButton} onPress={onCreateTask}>
        <Text style={styles.createTaskButtonText}>+ Create Task</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.scanTeamButton} onPress={onScanTeamMember}>
        <Text style={styles.scanTeamButtonText}>Scan for Team Member</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginTop: 24,
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
  createTaskButton: {
    marginTop: 14,
    backgroundColor: '#2563eb',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  createTaskButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  scanTeamButton: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#2563eb',
    paddingVertical: 12,
    borderRadius: 8,
    alignItems: 'center',
  },
  scanTeamButtonText: { color: '#2563eb', fontSize: 15, fontWeight: '700' },
});
