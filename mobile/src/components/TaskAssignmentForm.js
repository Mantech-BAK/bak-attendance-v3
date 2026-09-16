import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';
import { Ionicons } from '@expo/vector-icons';
import { fetchSummerBanStatus } from '../api/client';

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
  const [assignedEmpId, setAssignedEmpId] = useState(selfEmpId ?? null);
  const [projectCode, setProjectCode] = useState(null);
  const [priority, setPriority] = useState('medium');
  const [description, setDescription] = useState('');
  const [locationSite, setLocationSite] = useState('');
  const [isOutdoor, setIsOutdoor] = useState(null);
  const [shiftType, setShiftType] = useState('regular');
  const [summerBanActive, setSummerBanActive] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!isSelfMode) {
      setAssignedEmpId((prev) => prev ?? directReports?.[0]?.emp_id ?? null);
    }
    setProjectCode((prev) => prev ?? projects?.[0]?.project_code ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [directReports, projects]);

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
      setDescription('');
      setLocationSite('');
      setIsOutdoor(null);
      setShiftType('regular');
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
          <View style={styles.pickerWrapper}>
            <Picker selectedValue={assignedEmpId} onValueChange={setAssignedEmpId}>
              {(directReports || []).map((report) => (
                <Picker.Item key={report.emp_id} label={report.name} value={report.emp_id} />
              ))}
            </Picker>
          </View>
        </>
      )}

      <Text style={styles.label}>Project</Text>
      <View style={styles.pickerWrapper}>
        <Picker selectedValue={projectCode} onValueChange={setProjectCode}>
          {(projects || []).map((project) => (
            <Picker.Item
              key={project.project_code}
              label={project.project_name || project.project_code}
              value={project.project_code}
            />
          ))}
        </Picker>
      </View>

      <Text style={styles.label}>Priority</Text>
      <View style={styles.pickerWrapper}>
        <Picker selectedValue={priority} onValueChange={setPriority}>
          {PRIORITIES.map((p) => (
            <Picker.Item key={p} label={p} value={p} />
          ))}
        </Picker>
      </View>

      <Text style={styles.label}>Shift Type</Text>
      <View style={styles.pickerWrapper}>
        <Picker selectedValue={shiftType} onValueChange={setShiftType}>
          <Picker.Item label="Regular" value="regular" />
          <Picker.Item label="Night" value="night" />
        </Picker>
      </View>

      {summerBanActive && (
        <>
          <Text style={styles.label}>Indoor / Outdoor</Text>
          <View style={styles.pickerWrapper}>
            <Picker
              selectedValue={isOutdoor === null ? '' : isOutdoor ? 'outdoor' : 'indoor'}
              onValueChange={(v) => setIsOutdoor(v === '' ? null : v === 'outdoor')}
            >
              <Picker.Item label="Select…" value="" />
              <Picker.Item label="Indoor" value="indoor" />
              <Picker.Item label="Outdoor" value="outdoor" />
            </Picker>
          </View>
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
  pickerWrapper: { borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8 },
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
