// Local log of "was the sun/shade call right?" feedback, stored per-browser
// in localStorage (no backend). Each entry is a snapshot of what the app
// predicted at a specific displayed date/time, plus the user's up/down
// verdict — meant to be exported later and used to spot patterns in where
// the shadow-casting algorithm (src/shadow.js) gets it wrong.

const STORAGE_KEY = "uteservering-sol:votes-log";

function readLog() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeLog(entries) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // localStorage unavailable (private browsing, quota, etc.) — the vote
    // just won't persist; not worth surfacing an error for.
  }
}

/** Identifies "the same viewing" — this terrace, at this exact displayed moment. */
function matchKey(terraceId, viewedAt) {
  return `${terraceId}__${viewedAt}`;
}

/**
 * @returns {"up"|"down"|null} the logged verdict for this terrace at this
 *   exact displayed date/time, if any.
 */
export function getVoteForView(terraceId, viewedAt) {
  const entry = readLog().find((e) => matchKey(e.terraceId, e.viewedAt) === matchKey(terraceId, viewedAt));
  return entry?.verdict ?? null;
}

/**
 * Records (or clears, if clicking the same verdict again) a verdict for
 * this terrace at this exact displayed date/time.
 *
 * @param {string} terraceId
 * @param {string} terraceName
 * @param {string} viewedAt - ISO string of the date/time shown in the UI
 * @param {object} prediction - snapshot of computeShading()'s result:
 *   { status, altitudeDeg, bearingDeg, blockerName, distanceMeters }
 * @param {"up"|"down"} verdict
 * @returns {"up"|"down"|null} the resulting verdict (null if just cleared)
 */
export function recordVote(terraceId, terraceName, viewedAt, prediction, verdict) {
  const log = readLog();
  const key = matchKey(terraceId, viewedAt);
  const existingIndex = log.findIndex((e) => matchKey(e.terraceId, e.viewedAt) === key);
  const existing = log[existingIndex];

  if (existing && existing.verdict === verdict) {
    log.splice(existingIndex, 1);
    writeLog(log);
    return null;
  }

  const entry = {
    terraceId,
    terraceName,
    viewedAt,
    votedAt: new Date().toISOString(),
    prediction,
    verdict,
  };
  if (existingIndex >= 0) {
    log[existingIndex] = entry;
  } else {
    log.push(entry);
  }
  writeLog(log);
  return verdict;
}

export function getAllVotes() {
  return readLog();
}

export function clearAllVotes() {
  writeLog([]);
}

export function exportVotesAsJson() {
  return JSON.stringify(readLog(), null, 2);
}
