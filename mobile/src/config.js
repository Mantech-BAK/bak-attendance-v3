// EXPO_PUBLIC_API_BASE_URL comes from .env (Expo inlines EXPO_PUBLIC_* vars at build time).
// localhost only works in a simulator/emulator on the same machine as the backend —
// for a physical device via Expo Go, set this to your machine's LAN IP instead.
export const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://localhost:3000';

export const SUPERVISOR_DESIGNATION = 'Supervisor';
