import { useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, View } from 'react-native';
import PunchPhotoCamera from './PunchPhotoCamera';
import { uploadPunchPhoto } from '../api/client';

// Drives one capture-then-upload attempt for a task's in-photo or
// out-photo (2026-09-14). punchId is whichever punch (in or out) this
// photo belongs to — resolved by the caller from the task's
// in_punch_id/out_punch_id, never guessed here. A capture that fails to
// upload (network error, the punch already has a photo, etc.) drops back
// to the camera with the server's own message shown, same retry pattern
// as FaceRegistrationModal.
export default function PunchPhotoUploadModal({ visible, punchId, empId, label, onUploaded, onCancel }) {
  const [phase, setPhase] = useState('capturing'); // capturing | uploading
  const [errorMessage, setErrorMessage] = useState(null);

  async function handleCapture(photoUri) {
    setPhase('uploading');
    setErrorMessage(null);
    try {
      const punch = await uploadPunchPhoto(punchId, empId, photoUri);
      setPhase('capturing');
      onUploaded(punch);
    } catch (err) {
      setErrorMessage(err.message || 'Could not upload the photo. Please try again.');
      setPhase('capturing');
    }
  }

  if (!visible) return null;

  if (phase === 'uploading') {
    return (
      <Modal visible transparent animationType="fade">
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.overlayText}>Uploading photo…</Text>
        </View>
      </Modal>
    );
  }

  return (
    <PunchPhotoCamera
      visible
      instructionText={`${label}${errorMessage ? `\n${errorMessage}` : ''}`}
      onCapture={handleCapture}
      onCancel={onCancel}
    />
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center', gap: 16 },
  overlayText: { color: '#fff', fontSize: 15, fontWeight: '600' },
});
