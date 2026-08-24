import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Location from 'expo-location';
import { Ionicons } from '@expo/vector-icons';

/**
 * One button per task — no longer deduped by project_code (2026-08-23:
 * punches now track task_id, so two tasks sharing a project are two
 * separately punchable things, not one). The single department-default
 * fallback task (id: null, is_default: true) still renders as before when
 * the employee has no real task assigned.
 *
 * Tapping a task button both records a punch and declares which task it's
 * for, in one action. Tapping the same (currently open) task again closes
 * it. Only ONE task can be open at a time, globally — across every
 * project, not just within one (REVERTED 2026-08-23: a same-project
 * "tasks are independent" exception was tried and confirmed working, but
 * the actual requirement is the stricter global rule — opening a different
 * task while one is still open is always blocked, no exceptions).
 *
 * openTaskId/openProjectCode are a proactive client-side hint (fetched via
 * GET /api/punches/today-status) — the real enforcement is the server's
 * 409 on POST /api/punches, which this still falls back on for any race
 * (e.g. the hint went stale because another device punched in between).
 */
export default function PunchProjectList({ tasks, openTaskId, openProjectCode, onPunch }) {
  const [submittingKey, setSubmittingKey] = useState(null);
  const list = tasks || [];

  function taskKey(task) {
    return task.id ? `task:${task.id}` : `project:${task.project_code}`;
  }

  function isOpen(task) {
    return task.id ? task.id === openTaskId : task.project_code === openProjectCode && !openTaskId;
  }

  // Anything open (a real task or the fallback project) blocks every other
  // task/fallback until it's closed — global, not scoped to one project.
  // Returns a human-readable name for whatever's open, for the alert/hint.
  function blockedBy(task) {
    const anythingOpen = openTaskId !== null || openProjectCode !== null;
    if (!anythingOpen || isOpen(task)) return null;
    if (openTaskId) {
      const openTask = list.find((t) => t.id === openTaskId);
      return openTask ? openTask.name : `task ${openTaskId}`;
    }
    return openProjectCode;
  }

  async function handlePress(task) {
    if (submittingKey) return;

    const blockingName = blockedBy(task);
    if (blockingName) {
      Alert.alert('Something else is open', `Close "${blockingName}" before punching a different task.`);
      return;
    }

    setSubmittingKey(taskKey(task));
    try {
      // Location is best-effort only — permission denial, a disabled
      // location service, or a failed/timed-out fix must never block the
      // punch itself. Any of those simply mean lat/lng go through as null;
      // the backend accepts that and leaves resolved_address null too.
      let lat = null;
      let lng = null;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const location = await Location.getCurrentPositionAsync({});
          lat = location.coords.latitude;
          lng = location.coords.longitude;
        }
      } catch {
        // Swallow — lat/lng stay null, punch proceeds regardless.
      }

      await onPunch(task, { lat, lng });
    } catch (err) {
      Alert.alert('Punch failed', err.message);
    } finally {
      setSubmittingKey(null);
    }
  }

  if (list.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyRow}>
          <Ionicons name="file-tray-outline" size={16} color="#9ca3af" />
          <Text style={styles.empty}>No tasks assigned today</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.labelRow}>
        <Ionicons name="finger-print-outline" size={14} color="#6b7280" />
        <Text style={styles.label}>Tap a task to punch</Text>
      </View>
      {list.map((task) => {
        const open = isOpen(task);
        const blocked = !!blockedBy(task);
        const isSubmitting = submittingKey === taskKey(task);

        return (
          <TouchableOpacity
            key={taskKey(task)}
            style={[styles.projectButton, open && styles.openButton, blocked && styles.blockedButton]}
            onPress={() => handlePress(task)}
            disabled={!!submittingKey}
          >
            <Ionicons
              name={open ? 'radio-button-on' : 'radio-button-off-outline'}
              size={22}
              color={open ? '#fff' : '#2563eb'}
              style={styles.taskLeadingIcon}
            />
            <View style={styles.textWrap}>
              <View style={styles.nameRow}>
                <Text style={[styles.projectName, open && styles.openText]}>{task.name}</Text>
                {task.priority && (
                  <View style={[styles.priorityBadge, styles[`priority_${task.priority}`]]}>
                    <Text style={styles.priorityText}>{task.priority}</Text>
                  </View>
                )}
                {task.is_default && (
                  <View style={styles.defaultBadge}>
                    <Ionicons name="business-outline" size={11} color="#4338ca" />
                    <Text style={styles.defaultBadgeText}>DEFAULT</Text>
                  </View>
                )}
              </View>
              {task.display_id && (
                <Text style={[styles.taskIdHint, open && styles.openText]}>{task.display_id}</Text>
              )}
              {task.is_default && (
                <Text style={[styles.defaultHint, open && styles.openText]}>No task assigned — department default project</Text>
              )}
              {open && (
                <View style={styles.hintRow}>
                  <Ionicons name="checkmark-circle" size={12} color="#dbeafe" />
                  <Text style={styles.openHint}>Open — tap to close</Text>
                </View>
              )}
              {blocked && (
                <View style={styles.hintRow}>
                  <Ionicons name="lock-closed" size={12} color="#dc2626" />
                  <Text style={styles.blockedHint}>Close what's open first</Text>
                </View>
              )}
            </View>
            {isSubmitting && <ActivityIndicator color={open ? '#fff' : '#2563eb'} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 16, width: '100%' },
  labelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  label: { fontSize: 13, fontWeight: '600', color: '#6b7280' },
  emptyRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  empty: { fontSize: 14, color: '#9ca3af', fontStyle: 'italic' },
  projectButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#fff',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 10,
  },
  openButton: { backgroundColor: '#2563eb', borderColor: '#2563eb' },
  blockedButton: { opacity: 0.5 },
  taskLeadingIcon: { marginRight: 12 },
  textWrap: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  projectName: { fontSize: 16, fontWeight: '600', color: '#111827' },
  openText: { color: '#fff' },
  hintRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  openHint: { fontSize: 12, color: '#dbeafe' },
  blockedHint: { fontSize: 12, color: '#dc2626' },
  taskIdHint: { fontSize: 11, color: '#9ca3af', marginTop: 2 },
  priorityBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  priority_high: { backgroundColor: '#fee2e2' },
  priority_medium: { backgroundColor: '#fef3c7' },
  priority_low: { backgroundColor: '#f3f4f6' },
  priorityText: { fontSize: 11, fontWeight: '700', color: '#374151', textTransform: 'uppercase' },
  defaultBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 999,
    backgroundColor: '#e0e7ff',
  },
  defaultBadgeText: { fontSize: 11, fontWeight: '700', color: '#4338ca', textTransform: 'uppercase' },
  defaultHint: { fontSize: 12, color: '#6b7280', marginTop: 2 },
});
