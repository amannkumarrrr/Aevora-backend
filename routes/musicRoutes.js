const express = require('express');
const router = express.Router();
const musicController = require('../controllers/musicController');

// Search songs: GET /api/search?q=alone
router.get('/search', musicController.search);

// Song details: GET /api/song?query=<url-or-id>
router.get('/song', musicController.getSong);

// Lyrics on demand: GET /api/lyrics?query=<url-or-id>
router.get('/lyrics', musicController.getLyrics);

// Playlist: GET /api/playlist?query=<url-or-id>
router.get('/playlist', musicController.getPlaylist);

// Album: GET /api/album?query=<url-or-id>
router.get('/album', musicController.getAlbum);

// Trending songs for Homepage: GET /api/trending
router.get('/trending', musicController.getTrending);

module.exports = router;
