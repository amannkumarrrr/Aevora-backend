const axios = require('axios');
const CryptoJS = require('crypto-js');

// Base JioSaavn internal endpoints for fallback / direct resolution
const JIOSAAVN_BASE = 'https://www.jiosaavn.com/api.php';
const DES_KEY = '38346591';

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
 * Searches songs via configured external MUSIC_API_URL or direct JioSaavn fallback
 */
async function searchSongs(query) {
  if (!query || !query.trim()) return [];

  const musicApiUrl = process.env.MUSIC_API_URL;
  // 1. Try external MUSIC_API_URL if reachable
  if (musicApiUrl) {
    try {
      const target = `${musicApiUrl.replace(/\/$/, '')}/result/?query=${encodeURIComponent(query)}`;
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
    // Primary: search.getResults returns up to 20 full song records with encrypted_media_url
    const fullSearchUrl = `${JIOSAAVN_BASE}?__call=search.getResults&_format=json&_marker=0&cc=in&p=1&n=20&q=${encodeURIComponent(query)}`;
    const fullSearchRes = await axios.get(fullSearchUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
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
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      timeout: 6000,
    });

    const songsData = searchRes.data && searchRes.data.songs && searchRes.data.songs.data ? searchRes.data.songs.data : [];
    if (!songsData.length) return [];

    // Fetch song details for audio URLs (batch pids for speed)
    const pids = songsData.map(s => s.id).filter(Boolean);
    if (!pids.length) return [];

    const detailsUrl = `${JIOSAAVN_BASE}?__call=song.getDetails&cc=in&_marker=0%3F_marker%3D0&_format=json&pids=${pids.join(',')}`;
    const detailsRes = await axios.get(detailsUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
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
    console.error('Error in searchSongs:', err.message);
    throw new Error('Failed to search songs: ' + err.message);
  }
}

/**
 * Gets specific song metadata and audio URL
 */
async function getSong(queryOrId) {
  if (!queryOrId) throw new Error('Song query or ID is required');

  const musicApiUrl = process.env.MUSIC_API_URL;
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
      const pageRes = await axios.get(queryOrId, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 5000 });
      const match = pageRes.data.match(/"pid":"([^"]+)"/) || pageRes.data.match(/"song":{"type":"[^"]*","id":"([^"]+)"/);
      if (match && match[1]) pid = match[1];
    }

    const detailsUrl = `${JIOSAAVN_BASE}?__call=song.getDetails&cc=in&_marker=0%3F_marker%3D0&_format=json&pids=${encodeURIComponent(pid)}`;
    const res = await axios.get(detailsUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 6000 });
    const songData = res.data[pid] || Object.values(res.data)[0];
    if (!songData) throw new Error('Song details not found');
    return normalizeSong(songData);
  } catch (err) {
    console.error('Error in getSong:', err.message);
    throw new Error('Failed to retrieve song details: ' + err.message);
  }
}

/**
 * Gets lyrics for a song on demand
 */
async function getLyrics(queryOrId) {
  if (!queryOrId) throw new Error('Query containing song link or ID is required');

  const musicApiUrl = process.env.MUSIC_API_URL;
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
    if (queryOrId.startsWith('http')) {
      const songInfo = await getSong(queryOrId);
      lyricsId = songInfo.songid;
    }

    const lyricsUrl = `${JIOSAAVN_BASE}?__call=lyrics.getLyrics&ctx=web6dot0&api_version=4&_format=json&_marker=0%3F_marker%3D0&lyrics_id=${encodeURIComponent(lyricsId)}`;
    const res = await axios.get(lyricsUrl, { headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 6000 });
    if (res.data && res.data.lyrics) {
      return res.data.lyrics.replace(/<br\s*\/?>/gi, '\n');
    }
    return null;
  } catch (err) {
    console.error('Error fetching lyrics:', err.message);
    return null;
  }
}

/**
 * Gets playlist songs
 */
async function getPlaylist(query) {
  if (!query) throw new Error('Playlist query or URL required');

  const musicApiUrl = process.env.MUSIC_API_URL;
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

  const musicApiUrl = process.env.MUSIC_API_URL;
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
  getSong,
  getLyrics,
  getPlaylist,
  getAlbum,
  getTrendingSongs,
  normalizeSong,
};
