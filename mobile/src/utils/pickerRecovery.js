import { File, Paths } from 'expo-file-system';

// General safety net for the Report Leave form (2026-09-24). Report Leave now
// takes its photo with the in-app camera, so the original trigger - Android
// killing the app while a separate system camera/gallery activity was open -
// no longer happens. But the app keeps the identified employee only in
// memory, so ANY unexpected process death would still look like a logout and
// lose the form. So right before submitting, a small snapshot - who was
// identified plus the form draft - is written to disk, and the next launch
// restores it.
//
// Deliberately narrow, since it briefly persists an identified session: it
// holds no login code, is deleted the moment it is consumed, is ignored past
// MAX_AGE_MS, and is cleared on logout.
const MAX_AGE_MS = 10 * 60 * 1000;

function resumeFile() {
  return new File(Paths.document, 'pending-report-leave-resume.json');
}

export function saveResumeState(state) {
  try {
    const file = resumeFile();
    if (!file.exists) file.create();
    file.write(JSON.stringify({ savedAt: Date.now(), ...state }));
  } catch {
    // Best-effort — losing the safety net must never break the form itself.
  }
}

export function clearResumeState() {
  try {
    const file = resumeFile();
    if (file.exists) file.delete();
  } catch {
    // Nothing to clean up.
  }
}

// Returns the saved snapshot (and deletes it), or null if there is none, it
// is stale, or it cannot be read.
export function takeResumeState() {
  try {
    const file = resumeFile();
    if (!file.exists) return null;
    const parsed = JSON.parse(file.textSync());
    file.delete();
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > MAX_AGE_MS) return null;
    return parsed;
  } catch {
    return null;
  }
}
