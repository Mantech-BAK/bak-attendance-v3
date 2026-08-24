import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import TaskAssignmentForm from './TaskAssignmentForm';
import { fetchMyTaskList, fetchEmergencyWindow } from '../api/client';

// Item 2 — a read-only view of everything this employee has today,
// Completed tasks included (unlike PunchProjectList, the punch-selection
// picker, which drops them once they've reached the 2-punch cap). Item 4's
// self-service "Create Task" entry point lives here too, since both are
// about the employee's own task list rather than the act of punching.
const STATUS_META = {
  not_started: { label: 'Not Started', icon: 'ellipse-outline', color: '#9ca3af', bg: '#f3f4f6' },
  pending: { label: 'Pending', icon: 'time-outline', color: '#b45309', bg: '#fef3c7' },
  completed: { label: 'Completed', icon: 'checkmark-circle', color: '#15803d', bg: '#dcfce7' },
};

export default function MyTasksTab({ empId, projects, onTaskCreated }) {
  // tasks/window default to safe empty values (never null) so a failed
  // fetch — a real possibility, this is a network call — can't crash the
  // render below on a null .length/.is_open; loadError surfaces that
  // failure to the user instead.
  const [tasks, setTasks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [window_, setWindow] = useState({ start: null, end: null, is_open: false });
  const [showCreateForm, setShowCreateForm] = useState(false);

  async function load() {
    setLoading(true);
    setLoadError(null);
    try {
      const [list, win] = await Promise.all([fetchMyTaskList(empId), fetchEmergencyWindow()]);
      setTasks(list.tasks || []);
      setWindow(win);
    } catch (err) {
      setLoadError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [empId]);

  async function handleCreateSelfTask(values) {
    await onTaskCreated(values);
    setShowCreateForm(false);
    load();
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
      <View style={styles.headerRow}>
        <Text style={styles.heading}>My Tasks Today</Text>
        <TouchableOpacity
          style={[styles.createButton, !window_?.is_open && styles.createButtonDisabled]}
          onPress={() => setShowCreateForm((v) => !v)}
          disabled={!window_?.is_open}
        >
          <Ionicons name="add-circle" size={18} color={window_?.is_open ? '#fff' : '#9ca3af'} />
          <Text style={[styles.createButtonText, !window_?.is_open && styles.createButtonTextDisabled]}>Create Task</Text>
        </TouchableOpacity>
      </View>

      {loadError && (
        <View style={styles.errorBox}>
          <Ionicons name="cloud-offline-outline" size={16} color="#dc2626" />
          <Text style={styles.errorText}>Could not load your tasks: {loadError}</Text>
        </View>
      )}

      {!loadError && !window_.is_open && (
        <View style={styles.windowHint}>
          <Ionicons name="moon-outline" size={14} color="#6b7280" />
          <Text style={styles.windowHintText}>
            Self-service task creation opens {window_.start}–{window_.end}. Ask your supervisor to assign a task right now.
          </Text>
        </View>
      )}

      {showCreateForm && window_?.is_open && (
        <TaskAssignmentForm
          selfEmpId={empId}
          projects={projects}
          onSubmit={handleCreateSelfTask}
          heading="Create an Emergency Task"
          submitLabel="Create Task"
        />
      )}

      {tasks.length === 0 ? (
        <Text style={styles.empty}>No tasks assigned today</Text>
      ) : (
        tasks.map((task) => {
          const meta = STATUS_META[task.task_status] || STATUS_META.not_started;
          return (
            <View key={task.id} style={styles.taskRow}>
              <Ionicons name={meta.icon} size={20} color={meta.color} style={styles.taskIcon} />
              <View style={styles.taskInfo}>
                <Text style={styles.taskName}>{task.name}</Text>
                {task.display_id && <Text style={styles.taskId}>{task.display_id}</Text>}
              </View>
              <View style={[styles.statusBadge, { backgroundColor: meta.bg }]}>
                <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
              </View>
            </View>
          );
        })
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 16, width: '100%' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  heading: { fontSize: 16, fontWeight: '700', color: '#111827' },
  createButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#2563eb',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 8,
  },
  createButtonDisabled: { backgroundColor: '#e5e7eb' },
  createButtonText: { color: '#fff', fontWeight: '600', fontSize: 13 },
  createButtonTextDisabled: { color: '#9ca3af' },
  windowHint: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  windowHintText: { flex: 1, fontSize: 12, color: '#6b7280' },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fee2e2',
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  errorText: { flex: 1, fontSize: 12, color: '#dc2626' },
  empty: { fontSize: 14, color: '#9ca3af', fontStyle: 'italic' },
  taskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  taskIcon: { marginRight: 10 },
  taskInfo: { flex: 1 },
  taskName: { fontSize: 15, fontWeight: '600', color: '#111827' },
  taskId: { fontSize: 11, color: '#9ca3af', marginTop: 2 },
  statusBadge: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999 },
  statusText: { fontSize: 11, fontWeight: '700', textTransform: 'uppercase' },
});
