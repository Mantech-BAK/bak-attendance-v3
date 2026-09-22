// EXPO_PUBLIC_API_BASE_URL comes from .env (Expo inlines EXPO_PUBLIC_* vars at build time)
// and, for EAS builds, from the EAS-hosted environment variable of the same name — that way
// a build never silently loses the value just because a local, gitignored .env wasn't present
// wherever the build actually ran.
//
// IMPORTANT: the fallback below only ever points at localhost in __DEV__. A release build
// (what EAS produces and what ships to real devices) that somehow loses the env var falls back
// to the real production API instead of localhost — never the other way around. Losing the env
// var used to mean the app silently tried to reach localhost:3000 on a real employee's phone.
const PRODUCTION_API_BASE_URL = 'https://bak-attendance-v3.onrender.com';
const DEV_FALLBACK_API_BASE_URL = 'http://localhost:3000';

const envApiBaseUrl = process.env.EXPO_PUBLIC_API_BASE_URL;

if (!envApiBaseUrl) {
  // eslint-disable-next-line no-console
  console.warn(
    '[config] EXPO_PUBLIC_API_BASE_URL was not baked in at build time. ' +
      (__DEV__
        ? `Falling back to ${DEV_FALLBACK_API_BASE_URL} for local development.`
        : `This is a release build, so falling back to the production API (${PRODUCTION_API_BASE_URL}) instead of localhost.`)
  );
}

export const API_BASE_URL =
  envApiBaseUrl || (__DEV__ ? DEV_FALLBACK_API_BASE_URL : PRODUCTION_API_BASE_URL);
