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
import { Ionicons } from '@expo/vector-icons';

// TEMPORARY TESTING MEASURE — typed { empId, loginCode } identification
// standing in for real face capture. See backend/src/routes/punch.js for
// the full rationale; this is the mobile-side counterpart, replacing the
// old CameraCapture-based flow everywhere identification happens (self
// punch, "Scan Another Employee", supervisor "Scan Team Member").
//
// directReports (optional): when passed non-empty, "Scan Team Member"
// replaces the free-typed Employee ID field with a dropdown of the
// supervisor's own team — the code still has to be entered/verified either
// way, this just removes typing an ID the supervisor already knows by
// picking from a list instead. Self-identify and "Scan Another Employee"
// don't pass this (there's no "team" to scope a picker to), so they keep
// the free-text field unchanged.
export default function IdentifyCodeForm({ visible, onSubmit, onCancel, title = 'Enter Employee Code', directReports }) {
  const hasDirectReportsPicker = Array.isArray(directReports) && directReports.length > 0;
  const [empId, setEmpId] = useState('');
  const [loginCode, setLoginCode] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (visible) {
      setEmpId(hasDirectReportsPicker ? directReports[0].emp_id : '');
      setLoginCode('');
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
          <View style={styles.headingRow}>
            <Ionicons name="key-outline" size={20} color="#111827" />
            <Text style={styles.heading}>{title}</Text>
          </View>

          <Text style={styles.label}>Employee</Text>
          {hasDirectReportsPicker ? (
            <View style={styles.pickerWrapper}>
              <Picker selectedValue={empId} onValueChange={setEmpId}>
                {directReports.map((report) => (
                  <Picker.Item key={report.emp_id} label={report.name} value={report.emp_id} />
                ))}
              </Picker>
            </View>
          ) : (
            <TextInput
              style={styles.input}
              value={empId}
              onChangeText={setEmpId}
              placeholder="e.g. E1001"
              autoCapitalize="characters"
              autoCorrect={false}
              autoFocus
            />
          )}

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
              style={[styles.submitButton, submitting && styles.disabled]}
              onPress={handleSubmit}
              disabled={submitting}
            >
              {submitting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Ionicons name="checkmark-circle-outline" size={16} color="#fff" />
                  <Text style={styles.submitButtonText}>Submit</Text>
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
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20 },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 },
  heading: { fontSize: 18, fontWeight: '700', color: '#111827' },
  label: { fontSize: 13, fontWeight: '600', color: '#6b7280', marginBottom: 6, marginTop: 10 },
  input: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
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
