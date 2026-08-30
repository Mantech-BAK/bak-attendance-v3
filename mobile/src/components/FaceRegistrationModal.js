import { useState } from 'react';
import { ActivityIndicator, Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import FaceCaptureCamera from './FaceCaptureCamera';
import { getFaceEmbedding } from '../face/faceModel';
import { registerFaceEmbeddings } from '../api/client';

// Guided multi-angle capture for first-time self-registration (item 1-2 of
// the Face ID feature). 3 mandatory angles + 1 optional, each producing one
// on-device embedding via faceModel.getFaceEmbedding; all embeddings are
// submitted together in one POST once the sequence finishes. Follows the
// app's existing full-screen-Modal convention (no navigator anywhere in
// this app — see PunchScreen.js/App.js).
const MANDATORY_STEPS = [
  { key: 'straight', label: 'Look straight at the camera' },
  { key: 'left', label: 'Turn your head slightly to the LEFT' },
  { key: 'right', label: 'Turn your head slightly to the RIGHT' },
];
const OPTIONAL_STEP = { key: 'tilt', label: 'Tilt your head slightly up or down' };

export default function FaceRegistrationModal({ visible, empId, onComplete, onCancel }) {
  const [stepIndex, setStepIndex] = useState(0);
  const [embeddings, setEmbeddings] = useState([]);
  const [phase, setPhase] = useState('capturing'); // capturing | processing | optional-prompt | submitting | error
  const [errorMessage, setErrorMessage] = useState(null);

  const isOptionalStep = stepIndex >= MANDATORY_STEPS.length;
  const currentStep = isOptionalStep ? OPTIONAL_STEP : MANDATORY_STEPS[stepIndex];

  function reset() {
    setStepIndex(0);
    setEmbeddings([]);
    setPhase('capturing');
    setErrorMessage(null);
  }

  function handleCancel() {
    reset();
    onCancel();
  }

  async function handleCapture(photoUri) {
    setPhase('processing');
    setErrorMessage(null);
    try {
      const embedding = await getFaceEmbedding(photoUri);
      const next = [...embeddings, embedding];
      setEmbeddings(next);

      if (next.length < MANDATORY_STEPS.length) {
        setStepIndex(next.length);
        setPhase('capturing');
      } else if (next.length === MANDATORY_STEPS.length) {
        setPhase('optional-prompt');
      } else {
        await submit(next);
      }
    } catch (err) {
      setErrorMessage(err.message || 'Could not process that photo. Please try again.');
      setPhase('capturing');
    }
  }

  async function submit(finalEmbeddings) {
    setPhase('submitting');
    try {
      await registerFaceEmbeddings(empId, finalEmbeddings);
      reset();
      onComplete();
    } catch (err) {
      setErrorMessage(err.message || 'Could not save your Face ID. Please try again.');
      setPhase('optional-prompt');
    }
  }

  function handleAddOptional() {
    setStepIndex(MANDATORY_STEPS.length);
    setPhase('capturing');
  }

  function handleFinishWithoutOptional() {
    submit(embeddings);
  }

  if (!visible) return null;

  if (phase === 'processing' || phase === 'submitting') {
    return (
      <Modal visible transparent animationType="fade">
        <View style={styles.overlay}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.overlayText}>{phase === 'submitting' ? 'Saving your Face ID…' : 'Analyzing photo…'}</Text>
        </View>
      </Modal>
    );
  }

  if (phase === 'optional-prompt') {
    return (
      <Modal visible transparent animationType="slide">
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.headingRow}>
              <Ionicons name="checkmark-circle-outline" size={20} color="#111827" />
              <Text style={styles.heading}>3 of 3 angles captured</Text>
            </View>
            <Text style={styles.body}>
              You can add one more optional angle (tilted up or down) for better accuracy, or finish now.
            </Text>
            {errorMessage && <Text style={styles.error}>{errorMessage}</Text>}
            <View style={styles.actions}>
              <TouchableOpacity style={styles.secondaryButton} onPress={handleFinishWithoutOptional}>
                <Text style={styles.secondaryButtonText}>Finish</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.primaryButton} onPress={handleAddOptional}>
                <Text style={styles.primaryButtonText}>Add Optional Angle</Text>
              </TouchableOpacity>
            </View>
            <TouchableOpacity style={styles.cancelLink} onPress={handleCancel}>
              <Text style={styles.cancelLinkText}>Cancel Registration</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    );
  }

  const stepNumber = stepIndex + 1;
  const totalSteps = isOptionalStep ? MANDATORY_STEPS.length + 1 : MANDATORY_STEPS.length;

  return (
    <FaceCaptureCamera
      visible
      instructionText={`Step ${stepNumber} of ${totalSteps}: ${currentStep.label}${errorMessage ? `\n${errorMessage}` : ''}`}
      onCapture={handleCapture}
      onCancel={handleCancel}
    />
  );
}

const styles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.85)', alignItems: 'center', justifyContent: 'center', gap: 16 },
  overlayText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, paddingBottom: 32 },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 12 },
  heading: { fontSize: 18, fontWeight: '700', color: '#111827' },
  body: { fontSize: 14, color: '#4b5563', marginBottom: 8, lineHeight: 20 },
  error: { color: '#dc2626', fontSize: 13, marginBottom: 8 },
  actions: { flexDirection: 'row', gap: 12, marginTop: 12 },
  primaryButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', backgroundColor: '#2563eb' },
  primaryButtonText: { color: '#fff', fontWeight: '700' },
  secondaryButton: { flex: 1, paddingVertical: 12, borderRadius: 8, alignItems: 'center', backgroundColor: '#f3f4f6' },
  secondaryButtonText: { color: '#374151', fontWeight: '600' },
  cancelLink: { alignItems: 'center', marginTop: 16 },
  cancelLinkText: { color: '#dc2626', fontSize: 13, fontWeight: '600' },
});
