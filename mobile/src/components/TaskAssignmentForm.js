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

const PRIORITIES = ['low', 'medium', 'high'];

// Inline tab content, not a modal popup — Task Assignment is now its own
// persistent tab rather than a secondary action layered over the punch flow.
export default function TaskAssignmentForm({ directReports, projects, onSubmit }) {
  const [assignedEmpId, setAssignedEmpId] = useState(null);
  const [projectCode, setProjectCode] = useState(null);
  const [priority, setPriority] = useState('medium');
  const [description, setDescription] = useState('');
  const [locationSite, setLocationSite] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    setAssignedEmpId((prev) => prev ?? directReports?.[0]?.emp_id ?? null);
    setProjectCode((prev) => prev ?? projects?.[0]?.project_code ?? null);
  }, [directReports, projects]);

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

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({
        assignedEmpId,
        projectCode,
        priority,
        description: description.trim(),
        locationSite: locationSite.trim() || null,
      });
      setDescription('');
      setLocationSite('');
      setSuccess(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <Text style={styles.heading}>Assign a Task</Text>

      <Text style={styles.label}>Assign To</Text>
      <View style={styles.pickerWrapper}>
        <Picker selectedValue={assignedEmpId} onValueChange={setAssignedEmpId}>
          {(directReports || []).map((report) => (
            <Picker.Item key={report.emp_id} label={report.name} value={report.emp_id} />
          ))}
        </Picker>
      </View>

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

      {error && <Text style={styles.error}>{error}</Text>}
      {success && <Text style={styles.success}>Task assigned successfully.</Text>}

      <TouchableOpacity
        style={[styles.submitButton, submitting && styles.disabled]}
        onPress={handleSubmit}
        disabled={submitting}
      >
        {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitButtonText}>Create Task</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', backgroundColor: '#fff', borderRadius: 12, padding: 16, marginTop: 16 },
  heading: { fontSize: 16, fontWeight: '700', color: '#111827', marginBottom: 14 },
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
  error: { color: '#dc2626', marginTop: 10, fontSize: 13 },
  success: { color: '#16a34a', marginTop: 10, fontSize: 13, fontWeight: '600' },
  submitButton: {
    marginTop: 20,
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    backgroundColor: '#2563eb',
  },
  submitButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.6 },
});
