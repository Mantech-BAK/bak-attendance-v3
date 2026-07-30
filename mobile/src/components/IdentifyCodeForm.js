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

// TEMPORARY TESTING MEASURE — typed { empId, loginCode } identification
// standing in for real face capture. See backend/src/routes/punch.js for
// the full rationale; this is the mobile-side counterpart, replacing the
// old CameraCapture-based flow everywhere identification happens (self
// punch, "Scan Another Employee", supervisor "Scan Team Member").
export default function IdentifyCodeForm({ visible, onSubmit, onCancel, title = 'Enter Employee Code' }) {
  const [empId, setEmpId] = useState('');
  const [loginCode, setLoginCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (visible) {
      setEmpId('');
      setLoginCode('');
      setError(null);
    }
  }, [visible]);

  async function handleSubmit() {
    if (!empId.trim() || !loginCode.trim()) {
      setError('Employee ID and code are both required');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit({ empId: empId.trim(), loginCode: loginCode.trim() });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.heading}>{title}</Text>

          <Text style={styles.label}>Employee ID</Text>
          <TextInput
            style={styles.input}
            value={empId}
            onChangeText={setEmpId}
            placeholder="e.g. E1001"
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
          />

          <Text style={styles.label}>5-Letter Code</Text>
          <TextInput
            style={styles.input}
            value={loginCode}
            onChangeText={setLoginCode}
            placeholder="e.g. ABCDE"
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={5}
          />

          {error && <Text style={styles.error}>{error}</Text>}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelButton} onPress={onCancel} disabled={submitting}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.submitButton, submitting && styles.disabled]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitButtonText}>Submit</Text>}
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
  error: { color: '#dc2626', marginTop: 10, fontSize: 13 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  cancelButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', backgroundColor: '#f3f4f6' },
  cancelButtonText: { color: '#374151', fontWeight: '600' },
  submitButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', backgroundColor: '#2563eb' },
  submitButtonText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.6 },
});
