import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// Small chooser shown before either IdentifyCodeForm or FaceCaptureModal —
// the dual-auth entry point for self punch, "Scan Another Employee", and
// supervisor "Scan Team Member" all funnel through this same component.
export default function IdentifyMethodChooser({ visible, onChooseFace, onChooseCode, onCancel }) {
  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.heading}>How would you like to identify?</Text>

          <TouchableOpacity style={styles.optionButton} onPress={onChooseFace}>
            <Ionicons name="scan-outline" size={22} color="#2563eb" />
            <View style={styles.optionTextGroup}>
              <Text style={styles.optionTitle}>Use Face ID</Text>
              <Text style={styles.optionSubtitle}>Look at the camera — no code needed</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.optionButton} onPress={onChooseCode}>
            <Ionicons name="key-outline" size={22} color="#2563eb" />
            <View style={styles.optionTextGroup}>
              <Text style={styles.optionTitle}>Enter Employee ID + Code</Text>
              <Text style={styles.optionSubtitle}>Type your ID and 5-letter code</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancelButton} onPress={onCancel}>
            <Text style={styles.cancelButtonText}>Cancel</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, paddingBottom: 32 },
  heading: { fontSize: 18, fontWeight: '700', color: '#111827', marginBottom: 16 },
  optionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    marginBottom: 12,
  },
  optionTextGroup: { flex: 1 },
  optionTitle: { fontSize: 15, fontWeight: '700', color: '#111827' },
  optionSubtitle: { fontSize: 13, color: '#6b7280', marginTop: 2 },
  cancelButton: { paddingVertical: 12, alignItems: 'center', marginTop: 4 },
  cancelButtonText: { color: '#374151', fontWeight: '600' },
});
