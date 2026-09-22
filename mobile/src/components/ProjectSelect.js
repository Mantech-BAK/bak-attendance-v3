import { useMemo, useState } from 'react';
import { FlatList, Modal, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// Searchable project picker used everywhere a project is chosen (Create Team
// Task and Emergency Task, both employee and supervisor sides) — replaces
// the plain native <Picker> that used to be here.
//
// Two problems that native Picker had, both fixed by rendering our own list
// instead of a native one:
//   1. It could only be scrolled through, with no way to search by code or
//      name once the project list got long.
//   2. Rendered with zero items and a selectedValue that matches nothing —
//      exactly what happens for a fraction of a second right after identify,
//      before the projects list has finished loading — it's a known native
//      crash on Android with @react-native-picker/picker. A custom
//      JS-rendered list has no such failure mode: an empty list here just
//      renders an empty state message.
export default function ProjectSelect({ projects, value, onChange, placeholder = 'Select a project' }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');

  const list = projects || [];
  const selected = list.find((p) => p.project_code === value) || null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (p) =>
        (p.project_code || '').toLowerCase().includes(q) ||
        (p.project_name || '').toLowerCase().includes(q)
    );
  }, [list, query]);

  function handleOpen() {
    setQuery('');
    setOpen(true);
  }

  function handleSelect(project) {
    onChange(project.project_code);
    setOpen(false);
  }

  return (
    <>
      <TouchableOpacity style={styles.field} onPress={handleOpen}>
        {selected ? (
          <Text style={styles.fieldText} numberOfLines={1}>
            <Text style={styles.fieldCode}>{selected.project_code}</Text>
            {selected.project_name ? `  —  ${selected.project_name}` : ''}
          </Text>
        ) : (
          <Text style={styles.fieldPlaceholder}>{list.length ? placeholder : 'No projects available'}</Text>
        )}
        <Ionicons name="chevron-down" size={18} color="#6b7280" />
      </TouchableOpacity>

      <Modal visible={open} animationType="slide" transparent onRequestClose={() => setOpen(false)}>
        <View style={styles.backdrop}>
          <View style={styles.sheet}>
            <View style={styles.headingRow}>
              <Text style={styles.heading}>Select a Project</Text>
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
                placeholder="Search by code or name"
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
              keyExtractor={(item) => item.project_code}
              style={styles.list}
              keyboardShouldPersistTaps="handled"
              ListEmptyComponent={
                <Text style={styles.emptyText}>
                  {list.length ? 'No projects match your search.' : 'No projects available.'}
                </Text>
              }
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={[styles.option, item.project_code === value && styles.optionSelected]}
                  onPress={() => handleSelect(item)}
                >
                  <View style={styles.optionText}>
                    <Text style={styles.optionCode}>{item.project_code}</Text>
                    {item.project_name ? <Text style={styles.optionName}>{item.project_name}</Text> : null}
                  </View>
                  {item.project_code === value && <Ionicons name="checkmark" size={18} color="#2563eb" />}
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
  fieldCode: { fontWeight: '700' },
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
  optionCode: { fontSize: 14, fontWeight: '700', color: '#111827' },
  optionName: { fontSize: 13, color: '#6b7280', marginTop: 2 },
});
