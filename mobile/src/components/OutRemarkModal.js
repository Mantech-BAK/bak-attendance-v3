import { useEffect, useState } from 'react';
import {
  KeyboardAvoidingView,
  Modal,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import useKeyboardHeight from '../hooks/useKeyboardHeight';

const MAX_LENGTH = 500;

// Shown immediately before the CLOSING punch of a task (self or the
// supervisor's "Scan Team Member" on-behalf close) — mandatory, distinct
// from the opening punch which never prompts for anything here. Mirrors
// RejectReasonModal's shape but resolves a plain value back to its caller
// (PunchScreen's requestOutRemark) rather than calling an API itself — the
// actual punch submission (and its error handling) happens after this
// modal resolves, same pattern as the self-revalidation prompt.
export default function OutRemarkModal({ visible, subjectName, onSubmit, onCancel }) {
  const keyboardHeight = useKeyboardHeight();
  // Exactly ONE keyboard adjustment per platform (2026-09-24): Android lifts
  // the sheet by the measured keyboard height alone; wrapping it in
  // KeyboardAvoidingView 'height' as well lifted it ~2x. iOS keeps
  // KeyboardAvoidingView 'padding' on its own.
  const Backdrop = Platform.OS === 'ios' ? KeyboardAvoidingView : View;
  const backdropProps = Platform.OS === 'ios' ? { behavior: 'padding' } : {};
  const [remark, setRemark] = useState('');
  const [error, setError] = useState(null);

  useEffect(() => {
    if (visible) {
      setRemark('');
      setError(null);
    }
  }, [visible]);

  function handleSubmit() {
    const trimmed = remark.trim();
    if (!trimmed) {
      setError('A remark is required to close this task.');
      return;
    }
    if (trimmed.length > MAX_LENGTH) {
      setError(`Keep it under ${MAX_LENGTH} characters.`);
      return;
    }
    onSubmit(trimmed);
  }

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <Backdrop style={styles.backdrop} {...backdropProps}>
        <View style={[styles.sheet, Platform.OS === 'android' && { marginBottom: keyboardHeight }]}>
          <View style={styles.headingRow}>
            <Ionicons name="checkmark-done-circle-outline" size={20} color="#2563eb" />
            <Text style={styles.heading}>{subjectName ? `Closing Remark for ${subjectName}` : 'Closing Remark'}</Text>
          </View>
          <Text style={styles.body}>Describe what was done before closing this task. Required to punch out.</Text>

          <TextInput
            style={[styles.input, styles.textArea]}
            value={remark}
            onChangeText={setRemark}
            placeholder="e.g. Completed cable pull, tested and confirmed working"
            multiline
            autoFocus
            maxLength={MAX_LENGTH}
          />
          <Text style={styles.counter}>{remark.length}/{MAX_LENGTH}</Text>

          {error && (
            <View style={styles.errorRow}>
              <Ionicons name="alert-circle" size={16} color="#dc2626" />
              <Text style={styles.error}>{error}</Text>
            </View>
          )}

          <View style={styles.actions}>
            <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
              <Text style={styles.cancelButtonText}>Cancel</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.submitButton} onPress={handleSubmit}>
              <Ionicons name="checkmark-circle-outline" size={16} color="#fff" />
              <Text style={styles.submitButtonText}>Punch Out</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Backdrop>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20 },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  heading: { fontSize: 18, fontWeight: '700', color: '#111827' },
  body: { fontSize: 13, color: '#6b7280', marginBottom: 16, lineHeight: 18 },
  input: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  textArea: { minHeight: 90, textAlignVertical: 'top' },
  counter: { fontSize: 11, color: '#9ca3af', textAlign: 'right', marginTop: 4 },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  error: { color: '#dc2626', fontSize: 13 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  cancelButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', backgroundColor: '#f3f4f6' },
  cancelButtonText: { color: '#374151', fontWeight: '600' },
  submitButton: { flex: 1, flexDirection: 'row', gap: 6, paddingVertical: 12, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2563eb' },
  submitButtonText: { color: '#fff', fontWeight: '700' },
});
