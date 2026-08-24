import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

export default function EmployeeCard({ employee }) {
  return (
    <View style={styles.card}>
      <View style={styles.avatar}>
        <Ionicons name="person" size={28} color="#2563eb" />
      </View>
      <Text style={styles.name}>{employee.name}</Text>
      <View style={styles.designationRow}>
        <Ionicons name="briefcase-outline" size={13} color="#6b7280" />
        <Text style={styles.designation}>{employee.designation}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 20,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#eff6ff',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  name: { fontSize: 22, fontWeight: '700', color: '#111827' },
  designationRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  designation: { fontSize: 15, color: '#6b7280' },
});
