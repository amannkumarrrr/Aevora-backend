const axios = require('axios');

const LYRICS_OVH_BASE = (process.env.LYRICS_OVH_BASE || 'https://api.lyrics.ovh/v1').replace(/\/+$/, '');
const LYRICS_TIMEOUT_MS = parseInt(process.env.LYRICS_TIMEOUT_MS, 10) || 5000;

// In-memory cache for fetched lyrics: key -> { lyrics, expiresAt }
const cache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_CACHE_SIZE = 200;

/**
 * Normalizes string keys for caching
 */
function normalizeKey(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Removes parenthesis/brackets or extra metadata from titles (e.g. '(From "...")' or '(feat. ...)')
 */
function cleanSongTitle(title) {
  if (!title) return '';
  return String(title)
    .replace(/\s*[\(\[].*?[\)\]]/g, '')
    .replace(/\s*-\s*(single|remix|version|live|deluxe).*$/i, '')
    .trim();
}

/**
 * Extracts primary artist name if comma or ampersand separated
 */
function extractPrimaryArtist(artist) {
  if (!artist) return '';
  return String(artist)
    .split(/[,/&]|feat\.|ft\./i)[0]
    .trim();
}

/**
 * Gets an item from in-memory cache
 */
function getFromCache(key) {
  if (!key) return null;
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.lyrics;
}

/**
 * Sets an item in in-memory cache with eviction
 */
function setCache(key, lyrics, ttlMs = CACHE_TTL_MS) {
  if (!key) return;
  if (cache.size >= MAX_CACHE_SIZE) {
    const now = Date.now();
    for (const [k, v] of cache.entries()) {
      if (now > v.expiresAt) cache.delete(k);
    }
    if (cache.size >= MAX_CACHE_SIZE) {
      const firstKey = cache.keys().next().value;
      if (firstKey) cache.delete(firstKey);
    }
  }
  cache.set(key, {
    lyrics,
    expiresAt: Date.now() + ttlMs,
  });
}

/**
 * Clears the internal cache (for testing)
 */
function clearCache() {
  cache.clear();
}

/**
 * Helper to call single Lyrics.ovh endpoint:
 * GET https://api.lyrics.ovh/v1/{artist}/{title}
 */
async function queryLyricsOvh(artistName, songTitle) {
  const encArtist = encodeURIComponent(artistName);
  const encTitle = encodeURIComponent(songTitle);
  const url = `${LYRICS_OVH_BASE}/${encArtist}/${encTitle}`;

  try {
    const response = await axios.get(url, {
      headers: {
        Accept: 'application/json',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AevoraMusic/1.0',
      },
      timeout: LYRICS_TIMEOUT_MS,
    });

    if (response.status === 200 && response.data && typeof response.data.lyrics === 'string') {
      const text = response.data.lyrics.trim();
      if (text.length > 0) {
        return text;
      }
    }
    return null;
  } catch (error) {
    if (error.response && error.response.status === 404) {
      // Normal: song lyrics not found in database (not a server crash)
      return null;
    }
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      console.warn(`[Lyrics.ovh] Timeout for "${songTitle}" by "${artistName}".`);
    } else {
      console.warn(`[Lyrics.ovh] Request failed for "${songTitle}": ${error.message}`);
    }
    return null;
  }
}

/**
 * Fetches lyrics from Lyrics.ovh as a secondary fallback.
 *
 * @param {string} artist - Artist or singer name
 * @param {string} title - Song title
 * @returns {Promise<string|null>} Lyrics string or null
 */
async function fetchLyrics(artist, title) {
  if (!artist || !title) return null;

  const rawArtist = String(artist).trim();
  const rawTitle = String(title).trim();

  if (!rawArtist || !rawTitle) return null;

  const cacheKey = `${normalizeKey(rawArtist)}_${normalizeKey(rawTitle)}`;
  const cached = getFromCache(cacheKey);
  if (cached !== null) {
    return cached;
  }

  // 1. First attempt: exact artist and title
  let lyrics = await queryLyricsOvh(rawArtist, rawTitle);

  // 2. If not found, try with cleaned title or primary artist if different
  if (!lyrics) {
    const cleanTitle = cleanSongTitle(rawTitle);
    const primaryArtist = extractPrimaryArtist(rawArtist);

    const hasDifferentTitle = cleanTitle && cleanTitle.toLowerCase() !== rawTitle.toLowerCase();
    const hasDifferentArtist = primaryArtist && primaryArtist.toLowerCase() !== rawArtist.toLowerCase();

    if (hasDifferentTitle || hasDifferentArtist) {
      const candidateArtist = hasDifferentArtist ? primaryArtist : rawArtist;
      const candidateTitle = hasDifferentTitle ? cleanTitle : rawTitle;
      lyrics = await queryLyricsOvh(candidateArtist, candidateTitle);
    }
  }

  if (lyrics) {
    setCache(cacheKey, lyrics);
    return lyrics;
  }

  // Cache negative result for 5 minutes to prevent hammering API
  setCache(cacheKey, null, 5 * 60 * 1000);
  return null;
}

module.exports = {
  fetchLyrics,
  queryLyricsOvh,
  cleanSongTitle,
  extractPrimaryArtist,
  clearCache,
  getFromCache,
  setCache,
};
