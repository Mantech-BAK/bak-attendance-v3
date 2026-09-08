import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TaskAssignmentForm from './TaskAssignmentForm';
import { fetchEmergencyWindow } from '../api/client';

// Renamed from "My Tasks" — this tab is now specifically the entry point for
// an employee to self-create an emergency task during the allowed window,
// not a place to browse today's task list (the Punch tab already shows
// every task assigned today, Closed ones included — see PunchProjectList).
// Once created, the task appears in the normal Punch flow like any other,
// unchanged from the original design; only where creation itself happens
// from moved.
export default function EmergencyTaskTab({ empId, projects, onTaskCreated }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [window_, setWindow] = useState({ start: null, end: null, is_open: false });

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      setWindow(await fetchEmergencyWindow());
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, []);

  async function handleCreateSelfTask(values) {
    await onTaskCreated(values);
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <ActivityIndicator color="#2563eb" />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      {loadError && (
        <View style={styles.errorBox}>
          <Ionicons name="cloud-offline-outline" size={16} color="#dc2626" />
          <Text style={styles.errorText}>Could not check the emergency window: {loadError}</Text>
        </View>
      )}

      {!loadError && !window_.is_open && (
        <View style={styles.windowHint}>
          <Ionicons name="moon-outline" size={14} color="#6b7280" />
          <Text style={styles.windowHintText}>
            Emergency task creation opens {window_.start}–{window_.end}. Ask your supervisor to assign a task right now.
          </Text>
        </View>
      )}

      {!loadError && window_?.is_open && (
        <TaskAssignmentForm
          selfEmpId={empId}
          projects={projects}
          onSubmit={handleCreateSelfTask}
          heading="Create an Emergency Task"
          submitLabel="Create Task"
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 16, width: '100%' },
  windowHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    padding: 10,
  },
  windowHintText: { flex: 1, fontSize: 12, color: '#6b7280' },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fee2e2',
    borderRadius: 8,
    padding: 10,
  },
  errorText: { flex: 1, fontSize: 12, color: '#dc2626' },
});
