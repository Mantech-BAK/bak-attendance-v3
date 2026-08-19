import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

function Row({ label, value }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value ?? '—'}</Text>
    </View>
  );
}

// Own-details overlay for both Employee and Supervisor, opened via the
// header profile icon — a panel over whatever tab is currently active, not
// a navigation to a separate tab. Fetched separately from the minimal
// identify() response, which deliberately doesn't include
// department/status/login_code.
export default function ProfileOverlay({ visible, profile, loading, onClose }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <Text style={styles.heading}>My Profile</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeButtonText}>Close</Text>
            </TouchableOpacity>
          </View>

          {loading || !profile ? (
            <ActivityIndicator style={styles.spinner} />
          ) : (
            <View>
              <Row label="Employee ID" value={profile.emp_id} />
              <Row label="Name" value={profile.name} />
              <Row label="Designation" value={profile.designation} />
              <Row label="Department" value={profile.department} />
              <Row label="Company" value={profile.company} />
              <Row label="Status" value={profile.status} />
              <Row label="OT Eligible" value={profile.ot_eligible} />
              <Row label="Login Code" value={profile.login_code} />
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, paddingBottom: 32 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  heading: { fontSize: 18, fontWeight: '700', color: '#111827' },
  closeButton: { paddingVertical: 6, paddingHorizontal: 10 },
  closeButtonText: { color: '#2563eb', fontSize: 14, fontWeight: '600' },
  spinner: { marginVertical: 24 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  label: { fontSize: 14, color: '#6b7280' },
  value: { fontSize: 14, fontWeight: '600', color: '#111827' },
});
