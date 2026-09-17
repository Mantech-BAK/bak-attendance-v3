import { useRef, useState } from 'react';
import { Modal, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';

// Revives the deleted CameraCapture.js (git history, replaced by the typed
// { emp_id, login_code } form when face recognition was a stub) as the
// low-level capture surface for the real Face ID feature. Reused by both
// single-shot verification/re-validation and the multi-step guided
// registration flow — instructionText is the only thing that used to
// differ between steps.
//
// showFrameGuide (2026-09-16, real physical-device testing): the oval
// framing guide is now registration-only. On real devices it was
// positioned too low relative to where the face actually appears (its
// wrapper was centered against the FULL container height, including the
// bottom controls bar's space, rather than just the camera-visible area
// above it — see previewArea below) and wasn't actually helping identify/
// re-validate captures, only adding visual noise; registration is where a
// framing aid is worth the trouble, since it's a one-time guided flow, not
// a repeated quick capture.
export default function FaceCaptureCamera({ visible, instructionText, showFrameGuide = false, onCapture, onCancel }) {
  const cameraRef = useRef(null);
  const [permission, requestPermission] = useCameraPermissions();
  const [isCameraReady, setIsCameraReady] = useState(false);
  const [isCapturing, setIsCapturing] = useState(false);

  async function handleCapture() {
    if (!cameraRef.current || !isCameraReady || isCapturing) return;
    setIsCapturing(true);
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.8 });
      onCapture(photo.uri);
    } finally {
      setIsCapturing(false);
      setIsCameraReady(false);
    }
  }

  if (!visible) return null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onCancel}>
      <View style={styles.container}>
        {!permission ? (
          <View style={styles.center}>
            <Text style={styles.message}>Checking camera permission…</Text>
          </View>
        ) : !permission.granted ? (
          <View style={styles.center}>
            <Text style={styles.message}>Camera access is required for Face ID.</Text>
            <TouchableOpacity style={styles.primaryButton} onPress={requestPermission}>
              <Text style={styles.primaryButtonText}>Grant Camera Access</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.secondaryButton} onPress={onCancel}>
              <Text style={styles.secondaryButtonText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <>
            {/* previewArea (not the outer container) is what the framing
                guide centers against — it's sized to exactly the space
                above the controls bar, matching the CameraView's own
                visible bounds. Centering against the outer container
                instead (the previous bug) counted the controls bar's
                height into the centering math, pushing the guide visibly
                lower than where the camera image actually is. */}
            <View style={styles.previewArea}>
              <CameraView
                ref={cameraRef}
                style={styles.camera}
                facing="front"
                onCameraReady={() => setIsCameraReady(true)}
              />
              {showFrameGuide && (
                <View style={styles.frameGuideWrapper} pointerEvents="none">
                  <View style={styles.frameGuide} />
                </View>
              )}
              <View style={styles.tipBanner} pointerEvents="none">
                <Text style={styles.tipText}>
                  {showFrameGuide ? 'Face a light source · fill the oval · hold steady' : 'Face a light source · hold steady'}
                </Text>
              </View>
              {instructionText ? (
                <View style={styles.instructionBanner}>
                  <Text style={styles.instructionText}>{instructionText}</Text>
                </View>
              ) : null}
            </View>
            <View style={styles.controls}>
              <TouchableOpacity style={styles.secondaryButton} onPress={onCancel}>
                <Text style={styles.secondaryButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.captureButton, (!isCameraReady || isCapturing) && styles.disabled]}
                onPress={handleCapture}
                disabled={!isCameraReady || isCapturing}
              >
                <View style={styles.captureButtonInner} />
              </TouchableOpacity>
              <View style={styles.controlsSpacer} />
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  previewArea: { flex: 1 },
  camera: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  message: { color: '#fff', fontSize: 16, textAlign: 'center', marginBottom: 16 },
  instructionBanner: {
    position: 'absolute',
    top: 48,
    left: 24,
    right: 24,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  instructionText: { color: '#fff', fontSize: 15, fontWeight: '600', textAlign: 'center' },
  frameGuideWrapper: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
  },
  frameGuide: {
    width: 230,
    height: 290,
    borderRadius: 145,
    borderWidth: 3,
    borderColor: 'rgba(255,255,255,0.75)',
  },
  tipBanner: {
    position: 'absolute',
    bottom: 130,
    left: 24,
    right: 24,
    alignItems: 'center',
  },
  tipText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: '500',
    textAlign: 'center',
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingVertical: 32,
    backgroundColor: '#000',
  },
  controlsSpacer: { width: 70 },
  captureButton: {
    width: 74,
    height: 74,
    borderRadius: 37,
    borderWidth: 4,
    borderColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
  },
  captureButtonInner: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#fff',
  },
  disabled: { opacity: 0.4 },
  primaryButton: {
    backgroundColor: '#2563eb',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    marginBottom: 12,
  },
  primaryButtonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  secondaryButton: { paddingVertical: 10, paddingHorizontal: 16 },
  secondaryButtonText: { color: '#fff', fontSize: 15 },
});
