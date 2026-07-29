import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

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
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 4,
    marginBottom: 20,
    width: '100%',
    gap: 4,
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    paddingHorizontal: 4,
    borderRadius: 8,
    alignItems: 'center',
  },
  activeTab: { backgroundColor: '#2563eb' },
  tabText: { fontSize: 12, fontWeight: '600', color: '#6b7280', textAlign: 'center' },
  activeTabText: { color: '#fff' },
});
