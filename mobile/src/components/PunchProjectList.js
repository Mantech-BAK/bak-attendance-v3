import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Location from 'expo-location';

function dedupeByProjectCode(tasks) {
  const seen = new Map();
  for (const task of tasks || []) {
    if (!seen.has(task.project_code)) {
      seen.set(task.project_code, task);
    }
  }
  return [...seen.values()];
}

/**
 * There is no separate "select a project" step — tapping a project button
 * both records a punch and declares which project it's for, in one action.
 * Tapping the same (currently open) project again closes it. Tasks are
 * deduped by project_code since punches key on project_code, not task id —
 * two tasks under the same project would otherwise render as two buttons
 * for what's really one punchable project.
 *
 * openProjectCode is a proactive client-side hint (fetched via
 * GET /api/punches/today-status) — the real enforcement is the server's
 * 409 on POST /api/punches, which this still falls back on for any race
 * (e.g. the hint went stale because another device punched in between).
 */
export default function PunchProjectList({ tasks, openProjectCode, onPunch }) {
  const [submittingCode, setSubmittingCode] = useState(null);
  const projects = dedupeByProjectCode(tasks);

  async function handlePress(projectCode, projectName) {
    if (submittingCode) return;

    if (openProjectCode && openProjectCode !== projectCode) {
      const openName = projects.find((p) => p.project_code === openProjectCode)?.name ?? openProjectCode;
      Alert.alert('Project already open', `Close "${openName}" before punching a different project.`);
      return;
    }

    setSubmittingCode(projectCode);
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

      await onPunch(projectCode, projectName, { lat, lng });
    } catch (err) {
      Alert.alert('Punch failed', err.message);
    } finally {
      setSubmittingCode(null);
    }
  }

  if (projects.length === 0) {
    return (
      <View style={styles.container}>
        <Text style={styles.empty}>No tasks assigned today</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>Tap a project to punch</Text>
      {projects.map((project) => {
        const isOpen = project.project_code === openProjectCode;
        const blocked = !!openProjectCode && !isOpen;
        const isSubmitting = submittingCode === project.project_code;

        return (
          <TouchableOpacity
            key={project.project_code}
            style={[styles.projectButton, isOpen && styles.openButton, blocked && styles.blockedButton]}
            onPress={() => handlePress(project.project_code, project.name)}
            disabled={!!submittingCode}
          >
            <View style={styles.textWrap}>
              <View style={styles.nameRow}>
                <Text style={[styles.projectName, isOpen && styles.openText]}>{project.name}</Text>
                {project.priority && (
                  <View style={[styles.priorityBadge, styles[`priority_${project.priority}`]]}>
                    <Text style={styles.priorityText}>{project.priority}</Text>
                  </View>
                )}
              </View>
              {isOpen && <Text style={styles.openHint}>Open — tap to close</Text>}
              {blocked && <Text style={styles.blockedHint}>Close your open project first</Text>}
            </View>
            {isSubmitting && <ActivityIndicator color={isOpen ? '#fff' : '#2563eb'} />}
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginTop: 16, width: '100%' },
  label: { fontSize: 13, fontWeight: '600', color: '#6b7280', marginBottom: 8 },
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
  textWrap: { flex: 1 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  projectName: { fontSize: 16, fontWeight: '600', color: '#111827' },
  openText: { color: '#fff' },
  openHint: { fontSize: 12, color: '#dbeafe', marginTop: 2 },
  blockedHint: { fontSize: 12, color: '#dc2626', marginTop: 2 },
  priorityBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 999 },
  priority_high: { backgroundColor: '#fee2e2' },
  priority_medium: { backgroundColor: '#fef3c7' },
  priority_low: { backgroundColor: '#f3f4f6' },
  priorityText: { fontSize: 11, fontWeight: '700', color: '#374151', textTransform: 'uppercase' },
});
