import { LogBox } from 'react-native';
import PunchScreen from './src/screens/PunchScreen';

// TEMPORARY — suppresses LogBox during manual/automated UI testing so the
// SafeAreaView deprecation warning banner doesn't intercept taps. Revert
// before committing.
LogBox.ignoreAllLogs(true);

export default function App() {
  return <PunchScreen />;
}
