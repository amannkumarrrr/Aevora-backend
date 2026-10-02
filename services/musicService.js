const axios = require('axios');
const CryptoJS = require('crypto-js');
const deezerService = require('./deezerService');
const lyricsOvhService = require('./lyricsOvhService');

// Base JioSaavn internal endpoints for fallback / direct resolution
const JIOSAAVN_BASE = 'https://www.jiosaavn.com/api.php';
const DES_KEY = '38346591';
const JIO_GEO_IP = process.env.GEO_IP || '49.44.64.1'; // Reliance Jio Mumbai, India

/**
 * Returns standard JioSaavn headers with Indian regional geolocation routing.
 * Ensures that servers deployed in US/Europe (e.g. Vercel/AWS) can access
 * the full, unrestricted Indian catalog instead of geo-restricted truncated results.
 */
function getJioSaavnHeaders() {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9,hi;q=0.8,pa;q=0.7',
    'X-Forwarded-For': JIO_GEO_IP,
    'Client-IP': JIO_GEO_IP,
    'X-Real-IP': JIO_GEO_IP,
  };
}

/**
 * Resolves external MUSIC_API_URL safely.
 * On Vercel / production, automatically skips localhost / 127.0.0.1 URLs
 * because local computer ports are not accessible inside Vercel serverless containers.
 */
function getExternalApiUrl() {
  const musicApiUrl = process.env.MUSIC_API_URL;
  if (!musicApiUrl || !musicApiUrl.trim()) return null;
  const clean = musicApiUrl.trim().replace(/\/+$/, '');
  const isLocalhost = clean.includes('127.0.0.1') || clean.includes('localhost');
  if (process.env.VERCEL && isLocalhost) {
    return null;
  }
  return clean;
}

/**
 * Helper to clean HTML entities in strings
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
 * Decrypts JioSaavn encrypted_media_url to direct streaming audio URL
 */
function decryptMediaUrl(encUrl) {
  if (!encUrl) return '';
  try {
    const key = CryptoJS.enc.Utf8.parse(DES_KEY);
    const decrypted = CryptoJS.DES.decrypt(
      {
        ciphertext: CryptoJS.enc.Base64.parse(encUrl.trim()),
      },
      key,
      {
        mode: CryptoJS.mode.ECB,
        padding: CryptoJS.pad.Pkcs7,
      }
    );
    const decStr = decrypted.toString(CryptoJS.enc.Utf8);
    if (!decStr) return '';
    // Use 320kbps or 160kbps high quality audio
    return decStr.replace('_96.mp4', '_320.mp4');
  } catch (err) {
    console.error('Error decrypting audio URL:', err.message);
    return '';
  }
}

/**
 * Upgrades image URL resolution to 500x500 high quality
 */
function upgradeImageUrl(url) {
  if (!url) return 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=500&h=500&fit=crop';
  return url
    .replace('50x50', '500x500')
    .replace('150x150', '500x500')
    .replace('http://', 'https://');
}

/**
 * Normalizes song metadata into consistent format required by specification
 */
function normalizeSong(raw) {
  if (!raw) return null;

  // Handle both external JioSaavnAPI format and raw JioSaavn internal payload
  const id = raw.id || raw.songid || '';
  const title = cleanString(raw.title || raw.song || '');
  const singers = cleanString(raw.singers || raw.primary_artists || raw.artist || raw.music || 'Unknown Artist');
  const album = cleanString(raw.album || (raw.more_info && raw.more_info.album) || title);
  const album_url = raw.album_url || (raw.more_info && raw.more_info.album_url) || '';
  const duration = raw.duration || (raw.more_info && raw.more_info.duration) || '0';
  const language = raw.language || (raw.more_info && raw.more_info.language) || 'hindi';
  const year = raw.year || (raw.more_info && raw.more_info.year) || '';
  const perma_url = raw.perma_url || (raw.more_info && raw.more_info.perma_url) || '';

  let image_url = raw.image_url || raw.image || (raw.more_info && raw.more_info.image) || '';
  image_url = upgradeImageUrl(image_url);

  let audioUrl = raw.url || raw.media_url || '';
  // If only encrypted_media_url is present, decrypt it
  if (!audioUrl && (raw.encrypted_media_url || (raw.more_info && raw.more_info.encrypted_media_url))) {
    const enc = raw.encrypted_media_url || raw.more_info.encrypted_media_url;
    audioUrl = decryptMediaUrl(enc);
  }

  // Ensure https for streaming audio if saavncdn
  if (audioUrl && audioUrl.startsWith('http://') && audioUrl.includes('saavncdn.com')) {
    audioUrl = audioUrl.replace('http://', 'https://');
  }

  return {
    songid: id,
    id: id,
    title: title,
    singers: singers,
    album: album,
    album_url: album_url,
    duration: String(duration),
    image_url: image_url,
    language: language,
    year: String(year),
    lyrics: raw.lyrics || null,
    has_lyrics: raw.has_lyrics === 'true' || raw.has_lyrics === true,
    url: audioUrl,
    perma_url: perma_url,
  };
}

/**
 * Searches songs via configured external MUSIC_API_URL or direct JioSaavn fallback (PRIMARY API)
 */
async function searchPrimaryApi(query) {
  if (!query || !query.trim()) return [];

  const musicApiUrl = getExternalApiUrl();
  // 1. Try external MUSIC_API_URL if reachable (safely skips localhost in Vercel/production)
  if (musicApiUrl) {
    try {
      const target = `${musicApiUrl}/result/?query=${encodeURIComponent(query)}`;
      const resp = await axios.get(target, { timeout: 3500 });
      if (resp.data) {
        let results = [];
        if (Array.isArray(resp.data)) {
          results = resp.data;
        } else if (resp.data.data && Array.isArray(resp.data.data)) {
          results = resp.data.data;
        } else if (resp.data.songs && resp.data.songs.data) {
          results = resp.data.songs.data;
        }
        if (results.length > 0) {
          return results.map(normalizeSong).filter(s => s && s.title);
        }
      }
    } catch (err) {
      console.warn(`External MUSIC_API_URL (${musicApiUrl}) unreachable or failed: ${err.message}. Falling back to internal engine.`);
    }
  }

  // 2. Direct high-performance resolution with JioSaavn
  try {
    const headers = getJioSaavnHeaders();

    // Primary: search.getResults returns up to 20 full song records with encrypted_media_url
    const fullSearchUrl = `${JIOSAAVN_BASE}?__call=search.getResults&_format=json&_marker=0&cc=in&p=1&n=20&q=${encodeURIComponent(query)}`;
    const fullSearchRes = await axios.get(fullSearchUrl, {
      headers,
      timeout: 6000,
    });

    if (fullSearchRes.data && fullSearchRes.data.results && Array.isArray(fullSearchRes.data.results) && fullSearchRes.data.results.length > 0) {
      const normalized = fullSearchRes.data.results.map(normalizeSong).filter(s => s && s.title && s.url);
      if (normalized.length > 0) {
        return normalized;
      }
    }

    // Secondary fallback: autocomplete.get
    const searchUrl = `${JIOSAAVN_BASE}?__call=autocomplete.get&_format=json&_marker=0&cc=in&includeMetaTags=1&query=${encodeURIComponent(query)}`;
    const searchRes = await axios.get(searchUrl, {
      headers,
      timeout: 6000,
    });

    const songsData = searchRes.data && searchRes.data.songs && searchRes.data.songs.data ? searchRes.data.songs.data : [];
    if (!songsData.length) return [];

    // Fetch song details for audio URLs (batch pids for speed)
    const pids = songsData.map(s => s.id).filter(Boolean);
    if (!pids.length) return [];

    const detailsUrl = `${JIOSAAVN_BASE}?__call=song.getDetails&cc=in&_marker=0%3F_marker%3D0&_format=json&pids=${pids.join(',')}`;
    const detailsRes = await axios.get(detailsUrl, {
      headers,
      timeout: 8000,
    });

    const detailsMap = detailsRes.data || {};
    const songList = [];

    for (const rawSong of songsData) {
      const fullDetail = detailsMap[rawSong.id];
      if (fullDetail) {
        songList.push(normalizeSong(fullDetail));
      } else {
        songList.push(normalizeSong(rawSong));
      }
    }

    return songList.filter(s => s && s.title && s.url);
  } catch (err) {
    console.error('Error in searchPrimaryApi:', err.message);
    throw new Error('Failed to search songs: ' + err.message);
  }
}

/**
 * Searches songs using PRIMARY API first, and automatically falls back to Deezer Simple API
 * if primary returns empty results, errors out, or times out.
 *
 * Flow:
 * User searches for a song
 *         ↓
 * Existing PRIMARY music API
 *         ↓
 * Does it return usable results?
 *         ↓
 * YES → Use PRIMARY API results (Deezer is NOT called)
 *         ↓
 * NO / EMPTY / ERROR / TIMEOUT
 *         ↓
 * Call Deezer: https://api.deezer.com/search?q=<QUERY>
 *         ↓
 * Does Deezer return a usable result?
 *         ↓
 * YES → Normalize Deezer result → Return it
 *         ↓
 * NO → Return the existing "no results" behavior ([])
 */
async function searchSongs(query) {
  if (!query || !query.trim()) return [];

  let primaryResults = [];
  let primaryFailed = false;

  try {
    const primarySearchFn = module.exports.searchPrimaryApi || searchPrimaryApi;
    primaryResults = await primarySearchFn(query);
  } catch (err) {
    console.warn(`[Search] Primary music API failed or timed out: ${err.message}. Falling back to Deezer.`);
    primaryFailed = true;
    primaryResults = [];
  }

  // 1. If PRIMARY API returned usable results, use them directly (do NOT call Deezer)
  if (!primaryFailed && Array.isArray(primaryResults) && primaryResults.length > 0) {
    return primaryResults;
  }

  // 2. Primary API was empty, error, or timed out -> Fallback to Deezer Simple API
  console.log(`[Search] Primary API provided no usable results for "${query}". Calling Deezer fallback...`);
  try {
    const deezerResults = await deezerService.searchDeezer(query);
    if (Array.isArray(deezerResults) && deezerResults.length > 0) {
      console.log(`[Search] Deezer fallback returned ${deezerResults.length} usable results for "${query}".`);
      return deezerResults;
    }
  } catch (deezerErr) {
    console.warn(`[Search] Deezer fallback failed: ${deezerErr.message}. Gracefully continuing.`);
  }

  // 3. Neither API returned usable results -> Return existing "no results" behavior
  return [];
}

/**
 * Gets specific song metadata and audio URL
 */
async function getSong(queryOrId) {
  if (!queryOrId) throw new Error('Song query or ID is required');

  const musicApiUrl = getExternalApiUrl();
  if (musicApiUrl) {
    try {
      const target = `${musicApiUrl.replace(/\/$/, '')}/song/?query=${encodeURIComponent(queryOrId)}&lyrics=true`;
      const resp = await axios.get(target, { timeout: 3500 });
      if (resp.data) {
        if (Array.isArray(resp.data) && resp.data.length > 0) {
          return normalizeSong(resp.data[0]);
        }
        if (resp.data.title || resp.data.song) {
          return normalizeSong(resp.data);
        }
      }
    } catch (err) {
      console.warn(`External MUSIC_API_URL failed for song: ${err.message}.`);
    }
  }

  try {
    let pid = queryOrId;
    if (queryOrId.startsWith('http')) {
      // Fetch webpage to extract song ID
      const pageRes = await axios.get(queryOrId, { headers: getJioSaavnHeaders(), timeout: 5000 });
      const match = pageRes.data.match(/"pid":"([^"]+)"/) || pageRes.data.match(/"song":{"type":"[^"]*","id":"([^"]+)"/);
      if (match && match[1]) pid = match[1];
    }

    const detailsUrl = `${JIOSAAVN_BASE}?__call=song.getDetails&cc=in&_marker=0%3F_marker%3D0&_format=json&pids=${encodeURIComponent(pid)}`;
    const res = await axios.get(detailsUrl, { headers: getJioSaavnHeaders(), timeout: 6000 });
    const songData = res.data[pid] || Object.values(res.data)[0];
    if (!songData) throw new Error('Song details not found');
    return normalizeSong(songData);
  } catch (err) {
    console.warn(`[getSong] Primary API failed: ${err.message}. Trying Deezer fallback...`);
    try {
      const deezerTrack = await deezerService.getDeezerTrack(queryOrId);
      if (deezerTrack) {
        return deezerTrack;
      }
    } catch (deezerErr) {
      console.warn(`[getSong] Deezer track fallback error: ${deezerErr.message}`);
    }
    throw new Error('Failed to retrieve song details: ' + err.message);
  }
}

/**
 * Gets lyrics for a song on demand from JioSaavn (PRIMARY LYRICS SOURCE)
 */
async function getPrimaryLyrics(queryOrId) {
  if (!queryOrId) return null;

  const musicApiUrl = getExternalApiUrl();
  if (musicApiUrl) {
    try {
      const target = `${musicApiUrl.replace(/\/$/, '')}/lyrics/?query=${encodeURIComponent(queryOrId)}&lyrics=true`;
      const resp = await axios.get(target, { timeout: 3500 });
      if (resp.data && (resp.data.lyrics || resp.data.status)) {
        return resp.data.lyrics || resp.data;
      }
    } catch (err) {
      console.warn(`External MUSIC_API_URL failed for lyrics: ${err.message}`);
    }
  }

  try {
    let lyricsId = queryOrId;
    if (typeof queryOrId === 'string' && queryOrId.startsWith('http')) {
      const songInfo = await getSong(queryOrId);
      lyricsId = songInfo.songid;
    }

    const lyricsUrl = `${JIOSAAVN_BASE}?__call=lyrics.getLyrics&ctx=web6dot0&api_version=4&_format=json&_marker=0%3F_marker%3D0&lyrics_id=${encodeURIComponent(lyricsId)}`;
    const res = await axios.get(lyricsUrl, { headers: getJioSaavnHeaders(), timeout: 6000 });
    if (res.data && res.data.lyrics) {
      return res.data.lyrics.replace(/<br\s*\/?>/gi, '\n');
    }
    return null;
  } catch (err) {
    console.warn('Primary JioSaavn lyrics fetch failed:', err.message);
    return null;
  }
}

/**
 * Master getLyrics function with Lyrics.ovh fallback:
 *
 * Flow:
 * User opens lyrics for a song
 *         ↓
 * Existing JioSaavn lyrics system (PRIMARY)
 *         ↓
 * Are valid lyrics available?
 *         ↓
 * YES → Return JioSaavn lyrics (Lyrics.ovh is NOT called)
 *         ↓
 * NO / NULL / EMPTY / UNAVAILABLE / ERROR
 *         ↓
 * Call Lyrics.ovh: GET https://api.lyrics.ovh/v1/{artist}/{title}
 *         ↓
 * Lyrics found?
 *         ↓
 * YES → Return Lyrics.ovh lyrics
 *         ↓
 * NO / 404 / ERROR / TIMEOUT → Return null ("Lyrics are not available for this song.")
 */
async function getLyrics(queryOrId, artist = null, title = null) {
  if (!queryOrId && (!artist || !title)) return null;

  // 1. Try PRIMARY JioSaavn lyrics first
  try {
    const primaryLyricsFn = module.exports.getPrimaryLyrics || getPrimaryLyrics;
    const primaryLyrics = await primaryLyricsFn(queryOrId);
    if (primaryLyrics && typeof primaryLyrics === 'string' && primaryLyrics.trim() && primaryLyrics.trim() !== 'null') {
      return primaryLyrics.trim();
    }
  } catch (err) {
    console.warn(`[Lyrics] Primary lyrics error: ${err.message}. Falling back to Lyrics.ovh.`);
  }

  // 2. JioSaavn returned no lyrics, empty, or failed -> Fallback to Lyrics.ovh
  let songArtist = artist;
  let songTitle = title;

  // If artist/title not passed, try resolving from song metadata
  if (!songArtist || !songTitle) {
    try {
      const songInfo = await getSong(queryOrId);
      if (songInfo) {
        if (!songArtist) songArtist = songInfo.singers;
        if (!songTitle) songTitle = songInfo.title;
      }
    } catch (e) {
      // Song metadata could not be fetched
    }
  }

  if (songArtist && songTitle) {
    console.log(`[Lyrics] Primary lyrics unavailable. Trying Lyrics.ovh fallback for "${songTitle}" by "${songArtist}"...`);
    try {
      const ovhLyrics = await lyricsOvhService.fetchLyrics(songArtist, songTitle);
      if (ovhLyrics && typeof ovhLyrics === 'string' && ovhLyrics.trim()) {
        console.log(`[Lyrics] Lyrics.ovh fallback succeeded for "${songTitle}".`);
        return ovhLyrics.trim();
      }
    } catch (ovhErr) {
      console.warn(`[Lyrics] Lyrics.ovh request error: ${ovhErr.message}`);
    }
  }

  // 3. No lyrics from either source
  return null;
}

/**
 * Gets playlist songs
 */
async function getPlaylist(query) {
  if (!query) throw new Error('Playlist query or URL required');

  const musicApiUrl = getExternalApiUrl();
  if (musicApiUrl) {
    try {
      const target = `${musicApiUrl.replace(/\/$/, '')}/playlist/?query=${encodeURIComponent(query)}&lyrics=false`;
      const resp = await axios.get(target, { timeout: 4000 });
      if (resp.data) return resp.data;
    } catch (err) {
      console.warn(`External MUSIC_API_URL failed for playlist: ${err.message}`);
    }
  }

  // Fallback playlist search
  return await searchSongs(query);
}

/**
 * Gets album songs
 */
async function getAlbum(query) {
  if (!query) throw new Error('Album query or URL required');

  const musicApiUrl = getExternalApiUrl();
  if (musicApiUrl) {
    try {
      const target = `${musicApiUrl.replace(/\/$/, '')}/album/?query=${encodeURIComponent(query)}&lyrics=false`;
      const resp = await axios.get(target, { timeout: 4000 });
      if (resp.data) return resp.data;
    } catch (err) {
      console.warn(`External MUSIC_API_URL failed for album: ${err.message}`);
    }
  }

  // Fallback album search
  return await searchSongs(query);
}

/**
 * Gets trending / featured songs for homepage
 */
async function getTrendingSongs() {
  const trendingQueries = ['Top Bollywood', 'Global Hits', 'Arijit Singh', 'Trending India', 'Sidhu Moose Wala'];
  const randomQuery = trendingQueries[Math.floor(Math.random() * trendingQueries.length)];
  return await searchSongs(randomQuery);
}

module.exports = {
  searchSongs,
  searchPrimaryApi,
  getSong,
  getLyrics,
  getPrimaryLyrics,
  fetchLyricsOvh: lyricsOvhService.fetchLyrics,
  getPlaylist,
  getAlbum,
  getTrendingSongs,
  normalizeSong,
  normalizeDeezerSong: deezerService.normalizeDeezerSong,
  deduplicateSongs: deezerService.deduplicateSongs,
};
