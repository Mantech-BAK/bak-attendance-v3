import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Picker } from '@react-native-picker/picker';

const PRIORITIES = ['low', 'medium', 'high'];

export default function CreateTaskModal({ visible, directReports, projects, onSubmit, onClose }) {
  const [assignedEmpId, setAssignedEmpId] = useState(null);
  const [projectCode, setProjectCode] = useState(null);
  const [priority, setPriority] = useState('medium');
  const [description, setDescription] = useState('');
  const [location, setLocation] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (visible) {
      setAssignedEmpId(directReports?.[0]?.emp_id ?? null);
      setProjectCode(projects?.[0]?.project_code ?? null);
      setPriority('medium');
      setDescription('');
      setLocation('');
      setError(null);
    }
  }, [visible, directReports, projects]);

  async function handleSubmit() {
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
        location: location.trim() || null,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.heading}>Create Task</Text>

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
            value={location}
            onChangeText={setLocation}
            placeholder="e.g. Lagos HQ"
          />

          {error && <Text style={styles.error}>{error}</Text>}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelButton} onPress={onClose} disabled={submitting}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.submitButton, submitting && styles.disabled]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitButtonText}>Create</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20 },
  heading: { fontSize: 18, fontWeight: '700', marginBottom: 16, color: '#111827' },
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
  actions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  cancelButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', backgroundColor: '#f3f4f6' },
  cancelButtonText: { color: '#374151', fontWeight: '600' },
  submitButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', backgroundColor: '#2563eb' },
  submitButtonText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.6 },
});
