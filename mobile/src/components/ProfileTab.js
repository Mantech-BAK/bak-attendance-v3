import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';

function Row({ label, value }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <Text style={styles.value}>{value ?? '—'}</Text>
    </View>
  );
}

// Own-details view for both Employee and Supervisor (item 12). Fetched
// separately from the minimal identify() response, which deliberately
// doesn't include department/status/login_code.
export default function ProfileTab({ profile, loading }) {
  if (loading || !profile) {
    return (
      <View style={styles.container}>
        <ActivityIndicator style={styles.spinner} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>My Profile</Text>
      <Row label="Employee ID" value={profile.emp_id} />
      <Row label="Name" value={profile.name} />
      <Row label="Designation" value={profile.designation} />
      <Row label="Department" value={profile.department} />
      <Row label="Company" value={profile.company} />
      <Row label="Status" value={profile.status} />
      <Row label="OT Eligible" value={profile.ot_eligible} />
      <Row label="Login Code" value={profile.login_code} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', backgroundColor: '#fff', borderRadius: 12, padding: 16 },
  spinner: { marginVertical: 24 },
  heading: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 12 },
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
