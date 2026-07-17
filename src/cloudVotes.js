// Shared cloud storage for sun/shade verdicts, via Firebase Realtime
// Database (the database type that exists in this Firebase project).
// Append-only: every thumbs up/down is pushed as its own event entry
// under /votes, so votes from everyone who uses the site land in one
// place and can be analyzed later ("did several people say 👎 around
// the same time?").
//
// Deliberately fire-and-forget: the local log in votes.js stays the
// source of truth for the UI (instant, works offline), and cloud pushes
// happen in the background. If firebase-config.js has no config, or the
// network/rules/SDK fails, the app keeps working exactly like before —
// votes are just not shared.

import { firebaseConfig } from "./firebase-config.js";

let dbPromise = null;

function getDb() {
  if (!firebaseConfig) return null;
  if (!dbPromise) {
    // Dynamic import so the Firebase SDK is only fetched at all when a
    // config is actually present.
    dbPromise = (async () => {
      const [{ initializeApp }, rtdb] = await Promise.all([
        import("https://www.gstatic.com/firebasejs/12.0.0/firebase-app.js"),
        import("https://www.gstatic.com/firebasejs/12.0.0/firebase-database.js"),
      ]);
      const app = initializeApp(firebaseConfig);
      return { rtdb, db: rtdb.getDatabase(app) };
    })();
  }
  return dbPromise;
}

export function isCloudEnabled() {
  return Boolean(firebaseConfig);
}

/**
 * Pushes one verdict event to the shared store. Never throws — failures
 * are logged to the console and otherwise ignored, since the local log
 * already captured the vote.
 *
 * @param {object} entry - same shape as votes.js log entries:
 *   { terraceId, terraceName, viewedAt, votedAt, prediction, verdict }
 */
export async function pushVote(entry) {
  const handle = getDb();
  if (!handle) return;
  try {
    const { rtdb, db } = await handle;
    await rtdb.push(rtdb.ref(db, "votes"), entry);
  } catch (err) {
    console.warn("Kunde inte skicka bedömningen till den delade lagringen:", err);
  }
}
