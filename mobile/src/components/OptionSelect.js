import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

// Replaces the native @react-native-picker/picker <Picker> for small, fixed
// option sets (Priority, Shift Type, Indoor/Outdoor) — 2026-09-22, after a
// real-device report that a selected Picker value stopped being visible
// once chosen (selection registered correctly, just rendered invisible).
// The native Android Picker draws its closed-state text using whatever the
// device's OWN theme/dynamic-color system hands it, which this app never
// controls — the exact same class of problem ProjectSelect.js was already
// built to route around for the Project field. A tappable pill row is a
// fully custom View/Text — every color here is one this app sets itself,
// so there's nothing for any system theme to silently override.
export default function OptionSelect({ options, value, onChange }) {
  return (
    <View style={styles.row}>
      {options.map((opt) => {
        const selected = opt.value === value;
        return (
          <TouchableOpacity
            key={String(opt.value)}
            style={[styles.pill, selected && styles.pillSelected]}
            onPress={() => onChange(opt.value)}
          >
            <Text style={[styles.pillText, selected && styles.pillTextSelected]}>{opt.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e7eb',
    backgroundColor: '#fff',
  },
  pillSelected: {
    borderColor: '#2563eb',
    backgroundColor: '#2563eb',
  },
  pillText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#111827',
  },
  pillTextSelected: {
    color: '#fff',
  },
});
