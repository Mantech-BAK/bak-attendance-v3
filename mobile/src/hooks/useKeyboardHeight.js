import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

// KeyboardAvoidingView does not reliably resize content rendered inside a
// React Native <Modal> on Android (confirmed 2026-09-16, physical-device
// testing) — a Modal renders as a separate Android Dialog window, which
// doesn't receive the same resize behavior the Activity's own
// android:windowSoftInputMode="adjustResize" gives the main screen.
// IdentifyCodeForm/OutRemarkModal/RejectReasonModal all already used
// KeyboardAvoidingView and the keyboard still covered their inputs on a
// real device (never surfaced on the emulator). This hook tracks the
// keyboard's own height directly via Keyboard events instead, so a modal's
// content can be pushed up by exactly that amount regardless of the
// Dialog-window quirk — used alongside (not instead of) KeyboardAvoidingView,
// since the latter still works correctly on iOS.
export default function useKeyboardHeight() {
  const [height, setHeight] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const showSub = Keyboard.addListener(showEvent, (e) => setHeight(e.endCoordinates?.height || 0));
    const hideSub = Keyboard.addListener(hideEvent, () => setHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return height;
}
