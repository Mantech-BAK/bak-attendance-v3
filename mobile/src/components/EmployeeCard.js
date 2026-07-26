import { StyleSheet, Text, View } from 'react-native';

export default function EmployeeCard({ employee }) {
  return (
    <View style={styles.card}>
      <Text style={styles.name}>{employee.name}</Text>
      <Text style={styles.designation}>{employee.designation}</Text>
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
  name: { fontSize: 22, fontWeight: '700', color: '#111827' },
  designation: { fontSize: 15, color: '#6b7280', marginTop: 4 },
});
