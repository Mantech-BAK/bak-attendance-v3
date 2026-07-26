import { StyleSheet, Text, View } from 'react-native';
import { Picker } from '@react-native-picker/picker';

// Auto-selects the single task when there's exactly one; otherwise lets the
// employee pick from today's assigned tasks. Renders nothing (no punch
// blocker) when no tasks are assigned today.
//
// Selection is keyed by project_code (not task id) — punches are recorded
// against a project_code, and the punches table has no task_id column.
export default function TaskPicker({ tasks, selectedProjectCode, onSelect }) {
  if (!tasks || tasks.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.label}>Today's Task</Text>
        <Text style={styles.empty}>No tasks assigned today</Text>
      </View>
    );
  }

  if (tasks.length === 1) {
    return (
      <View style={styles.container}>
        <Text style={styles.label}>Today's Task</Text>
        <Text style={styles.singleTask}>{tasks[0].name}</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Select Today's Task</Text>
      <View style={styles.pickerWrapper}>
        <Picker selectedValue={selectedProjectCode} onValueChange={onSelect}>
          <Picker.Item label="Choose a task…" value={null} />
          {tasks.map((task) => (
            <Picker.Item key={task.id} label={task.name} value={task.project_code} />
          ))}
        </Picker>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 16, width: '100%' },
  label: { fontSize: 13, fontWeight: '600', color: '#6b7280', marginBottom: 6 },
  singleTask: { fontSize: 16, fontWeight: '600', color: '#111827' },
  empty: { fontSize: 14, color: '#9ca3af', fontStyle: 'italic' },
  pickerWrapper: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
  },
});
