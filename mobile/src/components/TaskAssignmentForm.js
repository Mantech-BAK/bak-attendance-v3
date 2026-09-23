import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { fetchSummerBanStatus } from '../api/client';
import ProjectSelect from './ProjectSelect';
import PersonSelect from './PersonSelect';
import OptionSelect from './OptionSelect';

const PRIORITIES = ['low', 'medium', 'high'];

// Inline tab content, not a modal popup — Create Task is its own persistent
// tab rather than a secondary action layered over the punch flow.
//
// selfEmpId switches this into self-service mode: the "Assign To" picker
// disappears (the task is always for selfEmpId, never chosen), used by the
// Emergency Tasks tab's window-gated create flow. Omitted, this behaves
// exactly as before — a supervisor assigning to one of directReports.
export default function TaskAssignmentForm({ directReports, projects, onSubmit, selfEmpId, heading, submitLabel }) {
  const isSelfMode = !!selfEmpId;
  // Every field genuinely starts blank (2026-09-23) — previously
  // assignedEmpId/projectCode auto-picked the first team member/project
  // from the fetched lists, and priority/shiftType pre-selected 'medium'/
  // 'regular', so the form looked already-filled-in on first open and an
  // admin who didn't look closely could submit a task for the wrong person
  // or project. selfEmpId is the one exception — it's not a user-facing
  // field at all in that mode (the "Assign To" picker doesn't even render).
  const [assignedEmpId, setAssignedEmpId] = useState(selfEmpId ?? null);
  const [projectCode, setProjectCode] = useState(null);
  const [priority, setPriority] = useState(null);
  const [description, setDescription] = useState('');
  const [locationSite, setLocationSite] = useState('');
  const [isOutdoor, setIsOutdoor] = useState(null);
  const [shiftType, setShiftType] = useState(null);
  const [summerBanActive, setSummerBanActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  // Indoor/Outdoor is only ever asked while a Summer Ban period is
  // currently declared/active — outside one, task creation stays exactly
  // as it was before this feature existed.
  useEffect(() => {
    fetchSummerBanStatus()
      .then((r) => setSummerBanActive(!!r.active))
      .catch(() => setSummerBanActive(false));
  }, []);

  async function handleSubmit() {
    setSuccess(false);

    if (!assignedEmpId) {
      setError('Choose who this task is assigned to');
      return;
    }
    if (!projectCode) {
      setError('Choose a project');
      return;
    }
    if (!priority) {
      setError('Choose a priority');
      return;
    }
    if (!shiftType) {
      setError('Choose a shift type');
      return;
    }
    if (!description.trim()) {
      setError('Description is required');
      return;
    }
    if (summerBanActive && isOutdoor === null) {
      setError('Select whether this task is Indoor or Outdoor');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        assignedEmpId,
        projectCode,
        priority,
        description: description.trim(),
        locationSite: locationSite.trim() || null,
        ...(summerBanActive ? { isOutdoor } : {}),
        shiftType,
      });
      // Reset the whole form back to empty/default after a successful
      // create — nothing from this submission should carry over into the
      // next one, including who it was assigned to and which project.
      if (!isSelfMode) {
        setAssignedEmpId(null);
      }
      setProjectCode(null);
      setPriority(null);
      setDescription('');
      setLocationSite('');
      setIsOutdoor(null);
      setShiftType(null);
      setSuccess(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.headingRow}>
        <Ionicons name="clipboard-outline" size={18} color="#111827" />
        <Text style={styles.heading}>{heading || 'Assign a Task'}</Text>
      </View>

      {!isSelfMode && (
        <>
          <Text style={styles.label}>Assign To</Text>
          <PersonSelect people={directReports} value={assignedEmpId} onChange={setAssignedEmpId} placeholder="Select a team member" />
        </>
      )}

      <Text style={styles.label}>Project</Text>
      <ProjectSelect projects={projects} value={projectCode} onChange={setProjectCode} />

      <Text style={styles.label}>Priority</Text>
      <OptionSelect
        options={PRIORITIES.map((p) => ({ label: p.charAt(0).toUpperCase() + p.slice(1), value: p }))}
        value={priority}
        onChange={setPriority}
      />

      <Text style={styles.label}>Shift Type</Text>
      <OptionSelect
        options={[
          { label: 'Regular', value: 'regular' },
          { label: 'Night', value: 'night' },
        ]}
        value={shiftType}
        onChange={setShiftType}
      />

      {summerBanActive && (
        <>
          <Text style={styles.label}>Indoor / Outdoor</Text>
          <OptionSelect
            options={[
              { label: 'Indoor', value: 'indoor' },
              { label: 'Outdoor', value: 'outdoor' },
            ]}
            value={isOutdoor === null ? '' : isOutdoor ? 'outdoor' : 'indoor'}
            onChange={(v) => setIsOutdoor(v === '' ? null : v === 'outdoor')}
          />
        </>
      )}

      <Text style={styles.label}>Description</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        value={description}
        onChangeText={setDescription}
        placeholder="What needs to be done"
        multiline
      />

      <Text style={styles.label}>Location (optional)</Text>
      <TextInput
        style={styles.input}
        value={locationSite}
        onChangeText={setLocationSite}
        placeholder="e.g. Lagos HQ"
      />

      {error && (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle" size={16} color="#dc2626" />
          <Text style={styles.error}>{error}</Text>
        </View>
      )}
      {success && (
        <View style={styles.successRow}>
          <Ionicons name="checkmark-circle" size={16} color="#16a34a" />
          <Text style={styles.success}>{isSelfMode ? 'Task created successfully.' : 'Task assigned successfully.'}</Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.submitButton, submitting && styles.disabled]}
        onPress={handleSubmit}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="add-circle-outline" size={18} color="#fff" />
            <Text style={styles.submitButtonText}>{submitLabel || 'Create Task'}</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', backgroundColor: '#fff', borderRadius: 12, padding: 16, marginTop: 16 },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  heading: { fontSize: 16, fontWeight: '700', color: '#111827' },
  label: { fontSize: 13, fontWeight: '600', color: '#6b7280', marginBottom: 6, marginTop: 10 },
  input: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  textArea: { minHeight: 70, textAlignVertical: 'top' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  successRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  error: { color: '#dc2626', fontSize: 13 },
  success: { color: '#16a34a', fontSize: 13, fontWeight: '600' },
  submitButton: {
    marginTop: 20,
    paddingVertical: 14,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#2563eb',
  },
  submitButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.6 },
});
