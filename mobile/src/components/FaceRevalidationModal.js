import { useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';
import FaceCaptureCamera from './FaceCaptureCamera';
import { getFaceEmbedding } from '../face/faceModel';
import { verifyFace } from '../api/client';

// Single-shot re-validation capture — the counterpart to FaceCaptureModal's
// open 1:N identify, but checks against ONE already-known employee (empId)
// instead of searching every registered face. Used to re-prove identity
// immediately before every self-punch (item 2, 2026-09-10) — a mismatch
// stays on this same capture screen for another attempt (no auto-fallback
// to the code option; that stays a separately chosen path, not something
// this screen switches to on failure).
export default function FaceRevalidationModal({ visible, empId, onVerified, onCancel }) {
  const [phase, setPhase] = useState('capturing'); // capturing | processing
  const [errorMessage, setErrorMessage] = useState(null);

  async function handleCapture(photoUri) {
    setPhase('processing');
    setErrorMessage(null);
    try {
      const embedding = await getFaceEmbedding(photoUri);
      await verifyFace(empId, embedding);
      setPhase('capturing');
      onVerified(embedding);
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
      instructionText={`Confirm it's you before punching${errorMessage ? `\n${errorMessage}` : ''}`}
      onCapture={handleCapture}
      onCancel={onCancel}
    />
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center', gap: 16 },
  overlayText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
