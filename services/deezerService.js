const axios = require('axios');

const DEEZER_BASE = (process.env.DEEZER_API_BASE || 'https://api.deezer.com').replace(/\/+$/, '');
const DEEZER_TIMEOUT_MS = parseInt(process.env.DEEZER_TIMEOUT_MS, 10) || 5000;

// Rate limiting: 50 requests per 5 seconds sliding window
const RATE_LIMIT_WINDOW_MS = 5000;
const MAX_REQUESTS_PER_WINDOW = 50;
let requestTimestamps = [];

// In-memory cache for Deezer search queries
const cache = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const MAX_CACHE_SIZE = 200;

/**
 * Clean HTML entities in strings
 */
function cleanString(str) {
  if (!str) return '';
  return String(str)
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&#039;/g, "'")
    .replace(/&copy;/g, '©');
}

/**
 * Normalizes title for duplicate checking
 */
function normalizeKey(str) {
  return String(str || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .trim();
}

/**
 * Enforces Deezer rate limit of 50 requests per 5 seconds
 */
async function checkAndApplyRateLimit() {
  const now = Date.now();
  requestTimestamps = requestTimestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);

  if (requestTimestamps.length >= MAX_REQUESTS_PER_WINDOW) {
    const oldestTimestamp = requestTimestamps[0];
    const waitTime = oldestTimestamp + RATE_LIMIT_WINDOW_MS - now + 25; // 25ms safety buffer
    if (waitTime > 0 && waitTime <= RATE_LIMIT_WINDOW_MS) {
      console.warn(`[Deezer RateLimit] Window limit reached (50 req/5s). Delaying request by ${waitTime}ms.`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }

  requestTimestamps.push(Date.now());
}

/**
 * Sets an item in cache with TTL and automatic eviction when size exceeds limit
 */
function setCache(key, data, ttlMs = CACHE_TTL_MS) {
  if (!key) return;
  if (cache.size >= MAX_CACHE_SIZE) {
    const now = Date.now();
    for (const [k, v] of cache.entries()) {
      if (now > v.expiresAt) {
        cache.delete(k);
      }
    }
    if (cache.size >= MAX_CACHE_SIZE) {
      const firstKey = cache.keys().next().value;
      if (firstKey) cache.delete(firstKey);
    }
  }
  cache.set(key, {
    data,
    expiresAt: Date.now() + ttlMs,
  });
}

/**
 * Gets an item from cache if not expired
 */
function getFromCache(key) {
  if (!key) return null;
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data;
}

/**
 * Clears the internal cache (useful for testing)
 */
function clearCache() {
  cache.clear();
  requestTimestamps = [];
}

/**
 * Normalizes a Deezer raw track object into the EXACT song object structure
 * that the Aevora frontend expects.
 *
 * Mapping rules:
 * - title: data[].title
 * - singers: data[].artist.name
 * - album: data[].album.title
 * - image_url: data[].album.cover_big / cover_medium / cover
 * - duration: data[].duration
 * - songid & id: data[].id
 * - perma_url: data[].link
 * - url: data[].preview (ONLY valid preview URLs, no full-track bypass)
 * - lyrics: null (not provided)
 * - has_lyrics: false (not provided)
 * - language: '' (not provided)
 * - year: '' (not provided)
 * - album_url: '' (not provided)
 */
function normalizeDeezerSong(raw) {
  if (!raw || !raw.id) return null;

  const id = String(raw.id);
  const title = cleanString(raw.title || raw.title_short || '');
  const singers = cleanString((raw.artist && raw.artist.name) || 'Unknown Artist');
  const album = cleanString((raw.album && raw.album.title) || title);
  const album_url = '';
  const duration = String(raw.duration || '0');

  let image_url = '';
  if (raw.album) {
    image_url =
      raw.album.cover_big ||
      raw.album.cover_medium ||
      raw.album.cover ||
      raw.album.cover_xl ||
      '';
  }
  if (!image_url && raw.artist) {
    image_url =
      raw.artist.picture_big ||
      raw.artist.picture_medium ||
      raw.artist.picture ||
      raw.artist.picture_xl ||
      '';
  }
  if (!image_url) {
    image_url = 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&h=500&fit=crop';
  }

  // Audio / Preview:
  // Deezer provides preview URLs (30s MP3 clip).
  // Treat as preview. Do NOT pretend it is a full song.
  // Do NOT bypass Deezer restrictions or construct unauthorized audio URLs.
  const previewUrl =
    raw.preview && typeof raw.preview === 'string' && raw.preview.startsWith('http')
      ? raw.preview.trim()
      : '';

  const perma_url = raw.link || '';

  return {
    songid: id,
    id: id,
    title: title,
    singers: singers,
    album: album,
    album_url: album_url,
    duration: duration,
    image_url: image_url,
    language: '',
    year: '',
    lyrics: null,
    has_lyrics: false,
    url: previewUrl,
    perma_url: perma_url,
  };
}

/**
 * Searches songs via the official Deezer Simple API
 * Endpoint: GET https://api.deezer.com/search?q=<QUERY>
 *
 * Respects rate limit (50 req/5s) and integrates query caching.
 */
async function searchDeezer(query) {
  if (!query || !query.trim()) return [];

  const trimmedQuery = query.trim();
  const cacheKey = trimmedQuery.toLowerCase();

  // 1. Check in-memory cache first to avoid redundant Deezer calls
  const cached = getFromCache(cacheKey);
  if (cached) {
    return cached;
  }

  // 2. Enforce Deezer rate limit: 50 requests per 5 seconds
  await checkAndApplyRateLimit();

  // 3. Call official Deezer search endpoint directly from backend
  try {
    const searchUrl = `${DEEZER_BASE}/search?q=${encodeURIComponent(trimmedQuery)}`;
    const response = await axios.get(searchUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Accept: 'application/json',
      },
      timeout: DEEZER_TIMEOUT_MS,
    });

    if (!response.data) {
      setCache(cacheKey, [], 60 * 1000);
      return [];
    }

    // Check for Deezer API error payload: { error: { message, code, type } }
    if (response.data.error) {
      console.warn(`[Deezer] API error for query "${trimmedQuery}":`, response.data.error.message || response.data.error);
      setCache(cacheKey, [], 60 * 1000);
      return [];
    }

    const rawData = response.data.data;
    if (!Array.isArray(rawData) || rawData.length === 0) {
      setCache(cacheKey, [], 60 * 1000);
      return [];
    }

    // 4. Normalize results and deduplicate by song ID
    const normalizedSongs = [];
    const seenIds = new Set();

    for (const item of rawData) {
      const norm = normalizeDeezerSong(item);
      if (!norm || !norm.title) continue;
      if (seenIds.has(norm.id)) continue;
      seenIds.add(norm.id);
      normalizedSongs.push(norm);
    }

    setCache(cacheKey, normalizedSongs);
    return normalizedSongs;
  } catch (error) {
    if (error.code === 'ECONNABORTED' || error.message?.includes('timeout')) {
      console.warn(`[Deezer] Timeout (${DEEZER_TIMEOUT_MS}ms) for query "${trimmedQuery}". Gracefully continuing.`);
    } else {
      console.warn(`[Deezer] Request failed for query "${trimmedQuery}": ${error.message}. Gracefully continuing.`);
    }
    // Never crash the backend on Deezer errors or timeouts
    return [];
  }
}

/**
 * Retrieves a single track by ID or URL from Deezer
 * Useful as a secondary fallback for /api/song
 */
async function getDeezerTrack(trackIdOrUrl) {
  if (!trackIdOrUrl) return null;

  let trackId = trackIdOrUrl;
  if (typeof trackIdOrUrl === 'string' && trackIdOrUrl.includes('deezer.com')) {
    const match = trackIdOrUrl.match(/track\/(\d+)/);
    if (match && match[1]) trackId = match[1];
  }

  trackId = String(trackId).replace(/\D/g, '');
  if (!trackId) return null;

  await checkAndApplyRateLimit();

  try {
    const response = await axios.get(`${DEEZER_BASE}/track/${trackId}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        Accept: 'application/json',
      },
      timeout: DEEZER_TIMEOUT_MS,
    });

    if (response.data && response.data.id && !response.data.error) {
      return normalizeDeezerSong(response.data);
    }
    return null;
  } catch (err) {
    console.warn(`[Deezer] getDeezerTrack error for ${trackId}:`, err.message);
    return null;
  }
}

/**
 * Deduplicate songs between primary and secondary (Deezer) results
 * - Prefers PRIMARY API results
 * - Uses song ID where available
 * - Otherwise uses normalized title + artist
 */
function deduplicateSongs(primarySongs = [], secondarySongs = []) {
  const result = [];
  const seenIds = new Set();
  const seenTitleArtist = new Set();

  for (const song of primarySongs || []) {
    if (!song) continue;
    const id = String(song.id || song.songid || '').trim();
    const tKey = normalizeKey(song.title);
    const aKey = normalizeKey(song.singers || song.artist);
    const comboKey = tKey && aKey ? `${tKey}_${aKey}` : tKey;

    if (id) seenIds.add(id);
    if (comboKey) seenTitleArtist.add(comboKey);
    result.push(song);
  }

  for (const song of secondarySongs || []) {
    if (!song) continue;
    const id = String(song.id || song.songid || '').trim();
    const tKey = normalizeKey(song.title);
    const aKey = normalizeKey(song.singers || song.artist);
    const comboKey = tKey && aKey ? `${tKey}_${aKey}` : tKey;

    if (id && seenIds.has(id)) continue;
    if (comboKey && seenTitleArtist.has(comboKey)) continue;

    if (id) seenIds.add(id);
    if (comboKey) seenTitleArtist.add(comboKey);
    result.push(song);
  }

  return result;
}

module.exports = {
  searchDeezer,
  getDeezerTrack,
  normalizeDeezerSong,
  deduplicateSongs,
  cleanString,
  clearCache,
  getFromCache,
  setCache,
};
