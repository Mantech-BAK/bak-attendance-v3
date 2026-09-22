import { useMemo, useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// Searchable person picker (name + emp_id) — same modal+search pattern as
// ProjectSelect.js, built for the same reason: replaces a native <Picker>
// (TaskAssignmentForm's "Assign To") that renders its selected value
// invisible on at least one real device's theme (2026-09-22 sweep).
export default function PersonSelect({ people, value, onChange, placeholder = 'Select a person' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const list = people || [];
  const selected = list.find((p) => p.emp_id === value) || null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (p) =>
        (p.name || '').toLowerCase().includes(q) ||
        (p.emp_id || '').toLowerCase().includes(q)
    );
  }, [list, query]);

  function handleOpen() {
    setQuery('');
    setOpen(true);
  }

  function handleSelect(person) {
    onChange(person.emp_id);
    setOpen(false);
  }

  return (
    <>
      <TouchableOpacity style={styles.field} onPress={handleOpen}>
        {selected ? (
          <Text style={styles.fieldText} numberOfLines={1}>
            {selected.name}
          </Text>
        ) : (
          <Text style={styles.fieldPlaceholder}>{list.length ? placeholder : 'No one available'}</Text>
        )}
        <Ionicons name="chevron-down" size={18} color="#6b7280" />
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.headingRow}>
              <Text style={styles.heading}>Select a Person</Text>
              <TouchableOpacity onPress={() => setOpen(false)}>
                <Ionicons name="close" size={22} color="#6b7280" />
              </TouchableOpacity>
            </View>

            <View style={styles.searchBox}>
              <Ionicons name="search" size={16} color="#9ca3af" />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Search by name or ID"
                autoFocus
              />
              {query.length > 0 && (
                <TouchableOpacity onPress={() => setQuery('')}>
                  <Ionicons name="close-circle" size={16} color="#9ca3af" />
                </TouchableOpacity>
              )}
            </View>

            <FlatList
              data={filtered}
              keyExtractor={(item) => item.emp_id}
              style={styles.list}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <Text style={styles.emptyText}>
                  {list.length ? 'No one matches your search.' : 'No one available.'}
                </Text>
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.option, item.emp_id === value && styles.optionSelected]}
                  onPress={() => handleSelect(item)}
                >
                  <View style={styles.optionText}>
                    <Text style={styles.optionName}>{item.name}</Text>
                    <Text style={styles.optionId}>{item.emp_id}</Text>
                  </View>
                  {item.emp_id === value && <Ionicons name="checkmark" size={18} color="#2563eb" />}
                </TouchableOpacity>
              )}
            />
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#e5e7eb',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  fieldText: { flex: 1, fontSize: 15, color: '#111827', marginRight: 8 },
  fieldPlaceholder: { flex: 1, fontSize: 15, color: '#9ca3af', marginRight: 8 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: '#fff', borderTopLeftRadius: 16, borderTopRightRadius: 16, padding: 20, maxHeight: '75%' },
  headingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  heading: { fontSize: 18, fontWeight: '700', color: '#111827' },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f3f4f6',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  searchInput: { flex: 1, fontSize: 15, color: '#111827', padding: 0 },
  list: { flexGrow: 0 },
  emptyText: { textAlign: 'center', color: '#9ca3af', fontSize: 13, paddingVertical: 24 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f3f4f6',
  },
  optionSelected: { backgroundColor: '#eff6ff' },
  optionText: { flex: 1, marginRight: 8 },
  optionName: { fontSize: 14, fontWeight: '700', color: '#111827' },
  optionId: { fontSize: 13, color: '#6b7280', marginTop: 2 },
});
