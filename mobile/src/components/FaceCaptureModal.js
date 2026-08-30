import { useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';
import FaceCaptureCamera from './FaceCaptureCamera';
import { getFaceEmbedding } from '../face/faceModel';
import { identifyByFace } from '../api/client';

// Single-shot Face ID verification — the counterpart to
// FaceRegistrationModal's multi-angle sequence, one capture instead of
// 3-4. onIdentified receives the same { emp_id, name, designation, tasks }
// shape identifyPunch already returns, so PunchScreen's existing
// applySelfIdentifyResult/applyTeamMemberResult need no changes at all.
export default function FaceCaptureModal({ visible, onIdentified, onCancel }) {
  const [phase, setPhase] = useState('capturing'); // capturing | processing
  const [errorMessage, setErrorMessage] = useState(null);

  async function handleCapture(photoUri) {
    setPhase('processing');
    setErrorMessage(null);
    try {
      const embedding = await getFaceEmbedding(photoUri);
      const result = await identifyByFace(embedding);
      setPhase('capturing');
      onIdentified(result);
    } catch (err) {
      setErrorMessage(err.message || 'Face not recognized. Please try again.');
      setPhase('capturing');
    }
  }

  if (!visible) return null;

  if (phase === 'processing') {
    return (
      <Modal visible transparent animationType="fade">
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.overlayText}>Verifying…</Text>
        </View>
      </Modal>
    );
  }

  return (
    <FaceCaptureCamera
      visible
      instructionText={`Look at the camera to identify yourself${errorMessage ? `\n${errorMessage}` : ''}`}
      onCapture={handleCapture}
      onCancel={onCancel}
    />
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center', gap: 16 },
  overlayText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
