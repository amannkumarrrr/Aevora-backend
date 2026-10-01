const musicService = require('../services/musicService');

/**
 * Search songs
 * GET /api/search?q=alone
 */
async function search(req, res) {
  try {
    const query = req.query.q || req.query.query;
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Search query parameter "q" is required',
        data: [],
      });
    }

    const songs = await musicService.searchSongs(query);
    return res.json({
      success: true,
      count: songs.length,
      data: songs,
    });
  } catch (error) {
    console.error('Controller search error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Music service is currently unavailable. Please try again later.',
      details: error.message,
      data: [],
    });
  }
}

/**
 * Get song details
 * GET /api/song?query=<song-url-or-id>
 */
async function getSong(req, res) {
  try {
    const query = req.query.query || req.query.id;
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Query parameter is required',
      });
    }

    const song = await musicService.getSong(query);
    if (!song) {
      return res.status(404).json({
        success: false,
        error: 'Song not found or invalid identifier',
      });
    }

    return res.json({
      success: true,
      data: song,
    });
  } catch (error) {
    console.error('Controller getSong error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'This song cannot be played right now.',
      details: error.message,
    });
  }
}

/**
 * Get lyrics
 * GET /api/lyrics?query=<song-url-or-id>
 */
async function getLyrics(req, res) {
  try {
    const query = req.query.query || req.query.id;
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Query parameter is required to fetch lyrics',
      });
    }

    const lyrics = await musicService.getLyrics(query);
    if (!lyrics) {
      return res.json({
        success: true,
        lyrics: null,
        message: 'Lyrics are not available for this song.',
      });
    }

    return res.json({
      success: true,
      lyrics: lyrics,
    });
  } catch (error) {
    console.error('Controller getLyrics error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Lyrics are not available.',
      details: error.message,
    });
  }
}

/**
 * Get playlist
 * GET /api/playlist?query=<playlist-url>
 */
async function getPlaylist(req, res) {
  try {
    const query = req.query.query || req.query.id;
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Playlist query parameter is required',
      });
    }

    const playlist = await musicService.getPlaylist(query);
    return res.json({
      success: true,
      data: playlist,
    });
  } catch (error) {
    console.error('Controller getPlaylist error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch playlist',
      details: error.message,
    });
  }
}

/**
 * Get album
 * GET /api/album?query=<album-url>
 */
async function getAlbum(req, res) {
  try {
    const query = req.query.query || req.query.id;
    if (!query) {
      return res.status(400).json({
        success: false,
        error: 'Album query parameter is required',
      });
    }

    const album = await musicService.getAlbum(query);
    return res.json({
      success: true,
      data: album,
    });
  } catch (error) {
    console.error('Controller getAlbum error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch album',
      details: error.message,
    });
  }
}

/**
 * Get curated trending & popular songs for homepage
 * GET /api/trending
 */
async function getTrending(req, res) {
  try {
    const songs = await musicService.getTrendingSongs();
    return res.json({
      success: true,
      count: songs.length,
      data: songs,
    });
  } catch (error) {
    console.error('Controller getTrending error:', error.message);
    return res.status(500).json({
      success: false,
      error: 'Unable to load trending songs',
      data: [],
    });
  }
}

module.exports = {
  search,
  getSong,
  getLyrics,
  getPlaylist,
  getAlbum,
  getTrending,
};
