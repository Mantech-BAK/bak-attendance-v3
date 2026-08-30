import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

const ROW_ICONS = {
  'Employee ID': 'id-card-outline',
  Name: 'person-outline',
  Designation: 'briefcase-outline',
  Department: 'business-outline',
  Company: 'storefront-outline',
  Status: 'pulse-outline',
  'OT Eligible': 'timer-outline',
  'Login Code': 'key-outline',
};

function Row({ label, value }) {
  return (
    <View style={styles.row}>
      <View style={styles.labelRow}>
        <Ionicons name={ROW_ICONS[label] || 'ellipse-outline'} size={15} color="#9ca3af" />
        <Text style={styles.label}>{label}</Text>
      </View>
      <Text style={styles.value}>{value ?? '—'}</Text>
    </View>
  );
}

// Own-details overlay for both Employee and Supervisor, opened via the
// header profile icon — a panel over whatever tab is currently active, not
// a navigation to a separate tab. Fetched separately from the minimal
// identify() response, which deliberately doesn't include
// department/status/login_code.
export default function ProfileOverlay({ visible, profile, loading, onClose, onRegisterFace }) {
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <View style={styles.headingRow}>
              <Ionicons name="person-circle-outline" size={22} color="#111827" />
              <Text style={styles.heading}>My Profile</Text>
            </View>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Ionicons name="close" size={16} color="#2563eb" />
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

              {profile.has_face_registered === false && (
                <TouchableOpacity style={styles.registerFaceButton} onPress={onRegisterFace}>
                  <Ionicons name="scan-outline" size={16} color="#2563eb" />
                  <Text style={styles.registerFaceButtonText}>Register Your Face</Text>
                </TouchableOpacity>
              )}
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
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heading: { fontSize: 18, fontWeight: '700', color: '#111827' },
  closeButton: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6, paddingHorizontal: 10 },
  closeButtonText: { color: '#2563eb', fontSize: 14, fontWeight: '600' },
  spinner: { marginVertical: 24 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  label: { fontSize: 14, color: '#6b7280' },
  value: { fontSize: 14, fontWeight: '600', color: '#111827' },
  registerFaceButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 16,
    paddingVertical: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#2563eb',
  },
  registerFaceButtonText: { color: '#2563eb', fontSize: 14, fontWeight: '700' },
});
