import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { Ionicons } from '@expo/vector-icons';
import { editPunch, fetchReassignableTasks } from '../api/client';

// A task's picker key — task.id when it's a real task, else a stable key
// for the single department-default fallback entry (id is null there) —
// same convention the backoffice's AddPunchModal uses.
function taskKey(task) {
  return task.id !== null ? `task:${task.id}` : `default:${task.project_code}`;
}

// Lets a supervisor reassign a pending team punch to a different task
// before approving it (2026-09-14) — Review Attendance's new Edit action,
// alongside the existing Approve/Reject. punch_time itself is never
// touched here, only which task/project the punch counts against.
// approval_status is deliberately untouched by this save — the punch stays
// pending, exactly as it was; approving is still its own separate tap.
export default function EditApprovalTaskModal({ visible, punch, supervisorEmpId, onSaved, onCancel }) {
  const [tasks, setTasks] = useState(null);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [selectedKey, setSelectedKey] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!visible || !punch) return;
    setError(null);
    setTasks(null);
    setSelectedKey(punch.task_id !== null ? `task:${punch.task_id}` : `default:${punch.project_code}`);

    let cancelled = false;
    setLoadingTasks(true);
    const date = punch.punch_time.slice(0, 10); // UTC date key, matches dateKey() server-side
    fetchReassignableTasks(punch.emp_id, date, supervisorEmpId)
      .then((result) => {
        if (cancelled) return;
        let list = result.tasks.map((t) => ({ ...t, id: t.id, project_code: t.project_code }));
        // The punch's own current task/project is always selectable, even
        // if it wouldn't otherwise show up (e.g. already Completed) — it's
        // the specific real punch being corrected.
        const currentKey = punch.task_id !== null ? `task:${punch.task_id}` : `default:${punch.project_code}`;
        if (!list.some((t) => taskKey(t) === currentKey)) {
          list = [
            {
              id: punch.task_id,
              display_id: punch.task_display_id,
              project_code: punch.project_code ?? '',
              name: punch.task_display_id ? `${punch.task_display_id} (current)` : (punch.project_code || 'Current'),
              is_default: punch.task_id === null,
            },
            ...list,
          ];
        }
        setTasks(list);
      })
      .catch((err) => {
        if (!cancelled) setError(err.message || 'Could not load tasks.');
      })
      .finally(() => {
        if (!cancelled) setLoadingTasks(false);
      });
    return () => {
      cancelled = true;
    };
  }, [visible, punch, supervisorEmpId]);

  async function handleSave() {
    const selected = tasks?.find((t) => taskKey(t) === selectedKey);
    if (!selected) {
      setError('Choose a task first.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const updated = await editPunch(punch.id, {
        taskId: selected.id,
        projectCode: selected.id ? null : selected.project_code,
        punchTime: punch.punch_time,
        supervisorEmpId,
      });
      onSaved(updated);
    } catch (err) {
      setError(err.message || 'Could not save this change.');
    } finally {
      setSubmitting(false);
    }
  }

  if (!visible || !punch) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <View style={styles.headingRow}>
            <Ionicons name="create-outline" size={20} color="#111827" />
            <Text style={styles.heading}>Reassign {punch.employee_name}'s Punch</Text>
          </View>
          <Text style={styles.body}>
            Choose the correct task before approving. This only changes what the punch counts against — it stays pending until you separately approve or reject it.
          </Text>

          {!tasks ? (
            <ActivityIndicator style={styles.spinner} />
          ) : (
            <View style={styles.pickerWrapper}>
              <Picker selectedValue={selectedKey} onValueChange={setSelectedKey} enabled={!submitting}>
                {tasks.map((t) => (
                  <Picker.Item key={taskKey(t)} label={t.display_id ? `${t.display_id} — ${t.name}` : t.name} value={taskKey(t)} />
                ))}
              </Picker>
            </View>
          )}

          {error && (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={16} color="#dc2626" />
              <Text style={styles.error}>{error}</Text>
            </View>
          )}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelButton} onPress={onCancel} disabled={submitting}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.submitButton, (submitting || loadingTasks) && styles.disabled]}
              onPress={handleSave}
              disabled={submitting || loadingTasks}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={16} color="#fff" />
                  <Text style={styles.submitButtonText}>Save</Text>
                </>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, paddingBottom: 32 },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  heading: { fontSize: 18, fontWeight: '700', color: '#111827', flexShrink: 1 },
  body: { fontSize: 13, color: '#6b7280', marginBottom: 16, lineHeight: 18 },
  spinner: { marginVertical: 16 },
  pickerWrapper: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  error: { color: '#dc2626', fontSize: 13 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  cancelButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', backgroundColor: '#f3f4f6' },
  cancelButtonText: { color: '#374151', fontWeight: '600' },
  submitButton: { flex: 1, flexDirection: 'row', gap: 6, paddingVertical: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2563eb' },
  submitButtonText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.6 },
});
