import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

// One icon per tab key — falls back to a generic dot if a new tab key is
// ever added here without a matching entry, rather than crashing.
const TAB_ICONS = {
  punch: 'finger-print-outline',
  'my-tasks': 'checkbox-outline',
  'scan-another': 'person-add-outline',
  'task-assignment': 'add-circle-outline',
  'scan-team-member': 'people-outline',
  'review-attendance': 'clipboard-outline',
  'punch-history': 'time-outline',
};

// No React Navigation in this app (single always-mounted screen) — tabs are
// just local state driving which pane renders, not a real navigator.
export default function TabBar({ tabs, activeTab, onSelectTab }) {
  return (
    <View style={styles.container}>
      {tabs.map((tab) => {
        const active = tab.key === activeTab;
        return (
          <TouchableOpacity
            key={tab.key}
            style={[styles.tab, active && styles.activeTab]}
            onPress={() => onSelectTab(tab.key)}
          >
            <Ionicons
              name={TAB_ICONS[tab.key] || 'ellipse-outline'}
              size={18}
              color={active ? '#fff' : '#6b7280'}
              style={styles.tabIcon}
            />
            <Text style={[styles.tabText, active && styles.activeTabText]} numberOfLines={1}>
              {tab.label}
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 4,
    marginBottom: 20,
    width: '100%',
    gap: 4,
  },
  tab: {
    flexGrow: 1,
    flexBasis: '31%',
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 8,
    alignItems: 'center',
  },
  activeTab: { backgroundColor: '#2563eb' },
  tabIcon: { marginBottom: 3 },
  tabText: { fontSize: 12, fontWeight: '600', color: '#6b7280', textAlign: 'center' },
  activeTabText: { color: '#fff' },
});
