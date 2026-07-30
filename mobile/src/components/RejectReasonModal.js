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

export default function RejectReasonModal({
  visible,
  onSubmit,
  onClose,
  title = 'Reject Punch',
  placeholder = 'Why is this punch being rejected?',
}) {
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (visible) {
      setReason('');
      setError(null);
    }
  }, [visible]);

  async function handleSubmit() {
    if (!reason.trim()) {
      setError('A reason is required');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await onSubmit(reason.trim());
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
          <Text style={styles.heading}>{title}</Text>

          <Text style={styles.label}>Reason</Text>
          <TextInput
            style={[styles.input, styles.textArea]}
            value={reason}
            onChangeText={setReason}
            placeholder={placeholder}
            multiline
            autoFocus
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
              {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.submitButtonText}>Reject</Text>}
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
  label: { fontSize: 13, fontWeight: '600', color: '#6b7280', marginBottom: 6 },
  input: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  textArea: { minHeight: 80, textAlignVertical: 'top' },
  error: { color: '#dc2626', marginTop: 10, fontSize: 13 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 20 },
  cancelButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', backgroundColor: '#f3f4f6' },
  cancelButtonText: { color: '#374151', fontWeight: '600' },
  submitButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', backgroundColor: '#dc2626' },
  submitButtonText: { color: '#fff', fontWeight: '700' },
  disabled: { opacity: 0.6 },
});
