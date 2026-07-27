import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity } from 'react-native';
import * as Location from 'expo-location';

// Captures GPS once per tap, then hands { lat, lng } to onPunch. There is no
// IN/OUT distinction at capture time — that's derived later, at attendance
// calculation time, from the ordering of punches within a day.
export default function PunchButtons({ onPunch, disabled }) {
  const [submitting, setSubmitting] = useState(false);

  async function handlePress() {
    if (disabled || submitting) return;
    setSubmitting(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location required', 'Location access is required to punch.');
        return;
      }

      const location = await Location.getCurrentPositionAsync({});
      await onPunch({
        lat: location.coords.latitude,
        lng: location.coords.longitude,
      });
    } catch (err) {
      Alert.alert('Punch failed', err.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <TouchableOpacity
      style={[styles.button, (disabled || submitting) && styles.disabled]}
      onPress={handlePress}
      disabled={disabled || submitting}
    >
      {submitting ? <ActivityIndicator color="#fff" /> : <Text style={styles.buttonText}>Punch</Text>}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  button: {
    marginTop: 20,
    width: '100%',
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#2563eb',
  },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
