// Local log of favorited terraces, stored per-browser in localStorage.
// Mirrors the pattern from votes.js — cached in-memory for fast lookups,
// synced to localStorage, and used by app.js to render stars and filter.

const STORAGE_KEY = "uteservering-sol:favorites";

// In-memory Set of favorited terraceIds, rebuilt from localStorage on first read.
let cachedFavorites = null;

function readFavorites() {
  if (cachedFavorites) return cachedFavorites;
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
    cachedFavorites = new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    cachedFavorites = new Set();
  }
  return cachedFavorites;
}

function writeFavorites(favorites) {
  cachedFavorites = favorites;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...favorites]));
  } catch {
    // localStorage unavailable — the favorite won't persist.
  }
}

/**
 * @param {string} terraceId
 * @returns {boolean} whether this terrace is in the user's favorites.
 */
export function isFavorite(terraceId) {
  return readFavorites().has(terraceId);
}

/**
 * Toggle favorite status for a terrace (add if absent, remove if present).
 * @param {string} terraceId
 * @returns {boolean} the new favorite status (true = now favorited)
 */
export function toggleFavorite(terraceId) {
  const favorites = readFavorites();
  if (favorites.has(terraceId)) {
    favorites.delete(terraceId);
    writeFavorites(favorites);
    return false;
  } else {
    favorites.add(terraceId);
    writeFavorites(favorites);
    return true;
  }
}

/**
 * @returns {string[]} array of all favorited terraceIds.
 */
export function getAllFavorites() {
  return [...readFavorites()];
}

/**
 * Clear all favorites.
 */
export function clearAllFavorites() {
  writeFavorites(new Set());
}
