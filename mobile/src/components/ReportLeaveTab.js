import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as ImagePicker from 'expo-image-picker';
import OptionSelect from './OptionSelect';
import { submitLeaveReport } from '../api/client';

const LEAVE_TYPES = ['Sick Leave', 'Annual Leave', 'Emergency Leave', 'Unpaid Leave', 'Compassionate Leave'];

function todayDateKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function toDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function formatDisplayDate(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

// New mobile tab (2026-09-23), same underlying screen for both an employee
// and a supervisor — self-reporting only, never on behalf of someone else
// (empId is always whoever is currently identified). Every field starts
// genuinely empty/unset, same spirit as the 2026-09-23 Task Creation blank-
// forms fix. The Supporting Photo step deliberately differs from the
// existing punch-photo flow (PunchPhotoCamera, camera-only): this one offers
// BOTH a camera capture and a gallery/file pick, and the photo itself is
// optional at submit time either way.
export default function ReportLeaveTab({ empId }) {
  const [leaveDate, setLeaveDate] = useState(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [leaveType, setLeaveType] = useState(null);
  const [remarks, setRemarks] = useState('');
  const [photoUri, setPhotoUri] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);

  function resetForm() {
    setLeaveDate(null);
    setLeaveType(null);
    setRemarks('');
    setPhotoUri(null);
  }

  function handleDateChange(event, selectedDate) {
    // Android's picker is a one-shot dialog (dismiss = 'dismissed' event,
    // no separate Cancel/Done step) — iOS's is an inline spinner that stays
    // open, so only Android closes itself here.
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }
    if (event.type === 'dismissed' || !selectedDate) return;
    setLeaveDate(toDateKey(selectedDate));
  }

  async function handleTakePhoto() {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Camera access is required to take a photo.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ quality: 0.8 });
    if (!result.canceled && result.assets?.[0]) {
      setPhotoUri(result.assets[0].uri);
    }
  }

  async function handleChooseFromGallery() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Photo library access is required to choose a photo.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ quality: 0.8, mediaTypes: ['images'] });
    if (!result.canceled && result.assets?.[0]) {
      setPhotoUri(result.assets[0].uri);
    }
  }

  async function handleSubmit() {
    setSuccess(false);

    if (!leaveDate) {
      setError('Choose the leave date');
      return;
    }
    if (!leaveType) {
      setError('Choose a leave type');
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      await submitLeaveReport({
        empId,
        leaveDate,
        leaveType,
        remarks: remarks.trim() || null,
        photoUri,
      });
      resetForm();
      setSuccess(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.headingRow}>
        <Ionicons name="calendar-outline" size={18} color="#111827" />
        <Text style={styles.heading}>Report Leave</Text>
      </View>

      <Text style={styles.label}>Date</Text>
      <TouchableOpacity style={styles.dateButton} onPress={() => setShowDatePicker(true)}>
        <Ionicons name="calendar-outline" size={16} color="#6b7280" />
        <Text style={leaveDate ? styles.dateButtonText : styles.dateButtonPlaceholder}>
          {leaveDate ? formatDisplayDate(leaveDate) : 'Select the leave date'}
        </Text>
      </TouchableOpacity>
      {showDatePicker && (
        <DateTimePicker
          value={leaveDate ? new Date(`${leaveDate}T00:00:00`) : new Date(`${todayDateKey()}T00:00:00`)}
          mode="date"
          display={Platform.OS === 'ios' ? 'inline' : 'default'}
          onChange={handleDateChange}
        />
      )}
      {Platform.OS === 'ios' && showDatePicker && (
        <TouchableOpacity style={styles.doneButton} onPress={() => setShowDatePicker(false)}>
          <Text style={styles.doneButtonText}>Done</Text>
        </TouchableOpacity>
      )}

      <Text style={styles.label}>Type of Leave</Text>
      <OptionSelect
        options={LEAVE_TYPES.map((t) => ({ label: t, value: t }))}
        value={leaveType}
        onChange={setLeaveType}
      />

      <Text style={styles.label}>Remarks (optional)</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        value={remarks}
        onChangeText={setRemarks}
        placeholder="Add any details about this leave"
        multiline
      />

      <Text style={styles.label}>Supporting Photo (optional)</Text>
      {photoUri ? (
        <View style={styles.photoPreviewRow}>
          <Image source={{ uri: photoUri }} style={styles.photoPreview} />
          <TouchableOpacity style={styles.removePhotoButton} onPress={() => setPhotoUri(null)}>
            <Ionicons name="trash-outline" size={14} color="#dc2626" />
            <Text style={styles.removePhotoText}>Remove Photo</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <View style={styles.photoButtonsRow}>
          <TouchableOpacity style={styles.photoButton} onPress={handleTakePhoto}>
            <Ionicons name="camera-outline" size={16} color="#2563eb" />
            <Text style={styles.photoButtonText}>Take Photo</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.photoButton} onPress={handleChooseFromGallery}>
            <Ionicons name="images-outline" size={16} color="#2563eb" />
            <Text style={styles.photoButtonText}>Choose from Gallery</Text>
          </TouchableOpacity>
        </View>
      )}

      {error && (
        <View style={styles.errorRow}>
          <Ionicons name="alert-circle" size={16} color="#dc2626" />
          <Text style={styles.error}>{error}</Text>
        </View>
      )}
      {success && (
        <View style={styles.successRow}>
          <Ionicons name="checkmark-circle" size={16} color="#16a34a" />
          <Text style={styles.success}>Leave reported successfully.</Text>
        </View>
      )}

      <TouchableOpacity
        style={[styles.submitButton, submitting && styles.disabled]}
        onPress={handleSubmit}
        disabled={submitting}
      >
        {submitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Ionicons name="paper-plane-outline" size={18} color="#fff" />
            <Text style={styles.submitButtonText}>Submit</Text>
          </>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { width: '100%', backgroundColor: '#fff', borderRadius: 12, padding: 16, marginTop: 16 },
  headingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 14 },
  heading: { fontSize: 16, fontWeight: '700', color: '#111827' },
  label: { fontSize: 13, fontWeight: '600', color: '#6b7280', marginBottom: 6, marginTop: 10 },
  input: {
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  textArea: { minHeight: 70, textAlignVertical: 'top' },
  dateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  dateButtonText: { fontSize: 15, color: '#111827', fontWeight: '600' },
  dateButtonPlaceholder: { fontSize: 15, color: '#9ca3af' },
  doneButton: { alignSelf: 'flex-end', paddingVertical: 8, paddingHorizontal: 14 },
  doneButtonText: { color: '#2563eb', fontSize: 14, fontWeight: '700' },
  photoButtonsRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  photoButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: '#2563eb',
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  photoButtonText: { color: '#2563eb', fontSize: 13, fontWeight: '700' },
  photoPreviewRow: { gap: 8 },
  photoPreview: { width: '100%', height: 180, borderRadius: 8, backgroundColor: '#f3f4f6' },
  removePhotoButton: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start' },
  removePhotoText: { color: '#dc2626', fontSize: 13, fontWeight: '600' },
  errorRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  successRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 10 },
  error: { color: '#dc2626', fontSize: 13 },
  success: { color: '#16a34a', fontSize: 13, fontWeight: '600' },
  submitButton: {
    marginTop: 20,
    paddingVertical: 14,
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: '#2563eb',
  },
  submitButtonText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  disabled: { opacity: 0.6 },
});
