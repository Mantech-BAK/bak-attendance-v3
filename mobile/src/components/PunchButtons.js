import { useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import * as Location from 'expo-location';

// Captures GPS once per tap, then hands { type, coords } to onPunch.
export default function PunchButtons({ onPunch, disabled }) {
  const [pendingType, setPendingType] = useState(null);

  async function handlePress(type) {
    if (disabled || pendingType) return;
    setPendingType(type);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Location required', 'Location access is required to punch in/out.');
        return;
      }

      const location = await Location.getCurrentPositionAsync({});
      await onPunch({
        type,
        lat: location.coords.latitude,
        lng: location.coords.longitude,
      });
    } catch (err) {
      Alert.alert('Punch failed', err.message);
    } finally {
      setPendingType(null);
    }
  }

  return (
    <View style={styles.row}>
      <TouchableOpacity
        style={[styles.button, styles.inButton, (disabled || pendingType) && styles.disabled]}
        onPress={() => handlePress('IN')}
        disabled={disabled || !!pendingType}
      >
        {pendingType === 'IN' ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Punch In</Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        style={[styles.button, styles.outButton, (disabled || pendingType) && styles.disabled]}
        onPress={() => handlePress('OUT')}
        disabled={disabled || !!pendingType}
      >
        {pendingType === 'OUT' ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <Text style={styles.buttonText}>Punch Out</Text>
        )}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 12, marginTop: 20, width: '100%' },
  button: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  inButton: { backgroundColor: '#16a34a' },
  outButton: { backgroundColor: '#dc2626' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  disabled: { opacity: 0.5 },
});
