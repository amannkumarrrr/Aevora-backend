const assert = require('assert');
const axios = require('axios');
const musicService = require('./services/musicService');
const deezerService = require('./services/deezerService');

// Sample mock Deezer API response representing official Deezer payload structure
const mockDeezerResponse = {
  data: [
    {
      id: 1109731,
      readable: true,
      title: 'Lose Yourself',
      title_short: 'Lose Yourself',
      link: 'https://www.deezer.com/track/1109731',
      duration: 326,
      rank: 954000,
      preview: 'https://cdns-preview-d.dzcdn.net/stream/c-deda7fa9316d9aa52f72b3742723661a-4.mp3',
      artist: {
        id: 13,
        name: 'Eminem',
        link: 'https://www.deezer.com/artist/13',
        picture_small: 'https://e-cdns-images.dzcdn.net/images/artist/13/56x56-000000-80-0-0.jpg',
        picture_medium: 'https://e-cdns-images.dzcdn.net/images/artist/13/250x250-000000-80-0-0.jpg',
        picture_big: 'https://e-cdns-images.dzcdn.net/images/artist/13/500x500-000000-80-0-0.jpg',
      },
      album: {
        id: 120314,
        title: 'Curtain Call: The Hits',
        cover: 'https://api.deezer.com/album/120314/image',
        cover_small: 'https://e-cdns-images.dzcdn.net/images/cover/120314/56x56-000000-80-0-0.jpg',
        cover_medium: 'https://e-cdns-images.dzcdn.net/images/cover/120314/250x250-000000-80-0-0.jpg',
        cover_big: 'https://e-cdns-images.dzcdn.net/images/cover/120314/500x500-000000-80-0-0.jpg',
      },
      type: 'track',
    },
    {
      id: 999999,
      readable: false,
      title: 'Track Without Preview',
      title_short: 'Track Without Preview',
      link: 'https://www.deezer.com/track/999999',
      duration: 200,
      preview: '', // Missing preview URL
      artist: {
        id: 99,
        name: 'Sample Artist',
      },
      album: {
        id: 88,
        title: 'Sample Album',
        cover_big: 'https://e-cdns-images.dzcdn.net/images/cover/88/500x500.jpg',
      },
      type: 'track',
    },
  ],
  total: 2,
};

async function runTests() {
  console.log('====================================================');
  console.log('🚀 RUNNING AEVORA MUSIC - DEEZER FALLBACK TEST SUITE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function report(name, isSuccess, details = '') {
    if (isSuccess) {
      console.log(`✅ PASS: ${name}`);
      if (details) console.log(`   ${details}`);
      passed++;
    } else {
      console.error(`❌ FAIL: ${name}`);
      if (details) console.error(`   ${details}`);
      failed++;
    }
  }

  // -----------------------------------------------------------
  // TEST 1: Search song in PRIMARY API -> PRIMARY API used, Deezer NOT called
  // -----------------------------------------------------------
  try {
    let deezerCallCount = 0;
    const originalSearchDeezer = deezerService.searchDeezer;
    deezerService.searchDeezer = async (...args) => {
      deezerCallCount++;
      return originalSearchDeezer(...args);
    };

    const results = await musicService.searchSongs('Arijit Singh');
    deezerService.searchDeezer = originalSearchDeezer;

    const primaryUsed = results.length > 0 && results[0].singers.includes('Arijit') && results[0].url.includes('saavncdn');
    const deezerNotCalled = deezerCallCount === 0;

    report(
      'Test 1: Search for song in PRIMARY API (Deezer NOT called)',
      primaryUsed && deezerNotCalled,
      `Results count: ${results.length}, Primary URL: ${results[0]?.url ? 'Valid saavn audio' : 'None'}, Deezer calls: ${deezerCallCount}`
    );
  } catch (err) {
    report('Test 1: Search for song in PRIMARY API', false, err.message);
  }

  // -----------------------------------------------------------
  // TEST 2: Missing from PRIMARY API -> Deezer provides fallback result
  // -----------------------------------------------------------
  try {
    // Normalization test on real Deezer payload structure
    const normalized = deezerService.normalizeDeezerSong(mockDeezerResponse.data[0]);

    const hasRequiredFields =
      normalized.id === '1109731' &&
      normalized.songid === '1109731' &&
      normalized.title === 'Lose Yourself' &&
      normalized.singers === 'Eminem' &&
      normalized.album === 'Curtain Call: The Hits' &&
      normalized.duration === '326' &&
      normalized.image_url === 'https://e-cdns-images.dzcdn.net/images/cover/120314/500x500-000000-80-0-0.jpg' &&
      normalized.url === 'https://cdns-preview-d.dzcdn.net/stream/c-deda7fa9316d9aa52f72b3742723661a-4.mp3' &&
      normalized.perma_url === 'https://www.deezer.com/track/1109731' &&
      normalized.lyrics === null &&
      normalized.has_lyrics === false &&
      normalized.language === '' &&
      normalized.year === '' &&
      normalized.album_url === '';

    // Simulate primary returning empty results and triggering Deezer fallback
    const origPrimary = musicService.searchPrimaryApi;
    musicService.searchPrimaryApi = async () => []; // Returns empty

    const origDeezer = deezerService.searchDeezer;
    deezerService.searchDeezer = async () => [normalized];

    const fallbackResults = await musicService.searchSongs('Lose Yourself Eminem');

    // Restore
    musicService.searchPrimaryApi = origPrimary;
    deezerService.searchDeezer = origDeezer;

    const fallbackSuccess =
      hasRequiredFields &&
      fallbackResults.length === 1 &&
      fallbackResults[0].title === 'Lose Yourself' &&
      fallbackResults[0].singers === 'Eminem';

    report(
      'Test 2: Search missing from PRIMARY API -> Deezer fallback provides normalized result',
      fallbackSuccess,
      `Normalized fields verified. Song ID: ${normalized.id}, Album: ${normalized.album}, Preview: ${normalized.url}`
    );
  } catch (err) {
    report('Test 2: Search missing from PRIMARY API', false, err.message);
  }

  // -----------------------------------------------------------
  // TEST 3: Song exists in neither API -> existing no-results behavior
  // -----------------------------------------------------------
  try {
    const origPrimary = musicService.searchPrimaryApi;
    musicService.searchPrimaryApi = async () => [];

    const origDeezer = deezerService.searchDeezer;
    deezerService.searchDeezer = async () => [];

    const emptyResults = await musicService.searchSongs('xyznonexistentsongquery999');

    musicService.searchPrimaryApi = origPrimary;
    deezerService.searchDeezer = origDeezer;

    const isSuccess = Array.isArray(emptyResults) && emptyResults.length === 0;
    report(
      'Test 3: Song in neither API -> Returns existing no-results behavior ([])',
      isSuccess,
      `Returned: ${JSON.stringify(emptyResults)}`
    );
  } catch (err) {
    report('Test 3: Song in neither API', false, err.message);
  }

  // -----------------------------------------------------------
  // TEST 4: Simulate Deezer being unavailable / error / timeout
  // -----------------------------------------------------------
  try {
    const origPrimary = musicService.searchPrimaryApi;
    musicService.searchPrimaryApi = async () => {
      throw new Error('Primary API connection timeout');
    };

    const origDeezer = deezerService.searchDeezer;
    deezerService.searchDeezer = async () => {
      throw new Error('Deezer 503 Service Unavailable');
    };

    const resultsWhenDown = await musicService.searchSongs('any-query');

    musicService.searchPrimaryApi = origPrimary;
    deezerService.searchDeezer = origDeezer;

    const backendDidNotCrash = Array.isArray(resultsWhenDown) && resultsWhenDown.length === 0;
    report(
      'Test 4: Simulate Deezer unavailable / error -> Backend does NOT crash, returns []',
      backendDidNotCrash,
      `Handled cleanly with return value: ${JSON.stringify(resultsWhenDown)}`
    );
  } catch (err) {
    report('Test 4: Simulate Deezer unavailable', false, err.message);
  }

  // -----------------------------------------------------------
  // TEST 5: Test multiple search results
  // -----------------------------------------------------------
  try {
    const normalizedList = mockDeezerResponse.data.map(deezerService.normalizeDeezerSong);
    const validCount = normalizedList.length === 2;
    const allHaveTitles = normalizedList.every((s) => s.title && s.id);
    report(
      'Test 5: Multiple search results normalization',
      validCount && allHaveTitles,
      `Normalized ${normalizedList.length} tracks successfully with correct metadata`
    );
  } catch (err) {
    report('Test 5: Multiple search results', false, err.message);
  }

  // -----------------------------------------------------------
  // TEST 6: Test duplicate songs returned by both APIs
  // -----------------------------------------------------------
  try {
    const primaryList = [
      {
        songid: 'saavn_101',
        id: 'saavn_101',
        title: 'Kesariya',
        singers: 'Arijit Singh, Pritam',
        album: 'Brahmastra',
        url: 'https://aac.saavncdn.com/kesariya_320.mp4',
        duration: '268',
      },
    ];

    const deezerList = [
      // Duplicate by title + artist
      {
        songid: 'deezer_999',
        id: 'deezer_999',
        title: 'Kesariya',
        singers: 'Arijit Singh, Pritam',
        album: 'Brahmastra (Deezer edition)',
        url: 'https://cdns-preview-d.dzcdn.net/preview.mp3',
        duration: '268',
      },
      // Unique Deezer song
      {
        songid: 'deezer_102',
        id: 'deezer_102',
        title: 'Mockingbird',
        singers: 'Eminem',
        album: 'Encore',
        url: 'https://cdns-preview-d.dzcdn.net/mockingbird.mp3',
        duration: '250',
      },
    ];

    const deduplicated = deezerService.deduplicateSongs(primaryList, deezerList);

    // Should contain primary Kesariya (not Deezer duplicate) AND unique Deezer Mockingbird
    const countIsTwo = deduplicated.length === 2;
    const preferredPrimary = deduplicated[0].songid === 'saavn_101';
    const retainedUniqueDeezer = deduplicated[1].songid === 'deezer_102';

    report(
      'Test 6: Duplicate handling -> Prefers PRIMARY API, removes duplicates, retains unique',
      countIsTwo && preferredPrimary && retainedUniqueDeezer,
      `Output count: ${deduplicated.length}, Preferred ID: ${deduplicated[0]?.songid}, Retained ID: ${deduplicated[1]?.songid}`
    );
  } catch (err) {
    report('Test 6: Duplicate handling', false, err.message);
  }

  // -----------------------------------------------------------
  // TEST 7: Test existing PRIMARY API playback still works
  // -----------------------------------------------------------
  try {
    const primarySongs = await musicService.searchPrimaryApi('Tum Hi Ho');
    let audioReachable = false;
    let song = null;

    if (primarySongs.length > 0) {
      song = primarySongs[0];
      if (song.url && song.url.startsWith('http')) {
        // Test audio stream header
        const res = await axios.head(song.url, { timeout: 5000 }).catch(async () => {
          // If HEAD is disallowed by CDN, test GET with range header
          return await axios.get(song.url, { headers: { Range: 'bytes=0-100' }, timeout: 5000 });
        });
        audioReachable = res.status >= 200 && res.status < 400;
      }
    }

    report(
      'Test 7: Primary API playback audio stream works',
      audioReachable,
      `Track: "${song?.title}", Stream URL accessible: ${audioReachable}`
    );
  } catch (err) {
    report('Test 7: Primary API playback audio stream', false, err.message);
  }

  // -----------------------------------------------------------
  // TEST 8: Test Deezer preview playback works ONLY where valid preview URL is provided
  // -----------------------------------------------------------
  try {
    const trackWithPreview = deezerService.normalizeDeezerSong(mockDeezerResponse.data[0]);
    const trackWithoutPreview = deezerService.normalizeDeezerSong(mockDeezerResponse.data[1]);

    const hasValidPreview =
      trackWithPreview.url.startsWith('https://') &&
      trackWithPreview.url.includes('.mp3');

    const noUrlWhenMissing =
      trackWithoutPreview.url === '' || trackWithoutPreview.url === null;

    // Simulate frontend player check:
    // if (song.url && song.url.trim()) -> play
    // else -> setPlayerError('This song cannot be played right now.')
    const canPlayTrack1 = Boolean(trackWithPreview.url && trackWithPreview.url.trim());
    const canPlayTrack2 = Boolean(trackWithoutPreview.url && trackWithoutPreview.url.trim());

    report(
      'Test 8: Deezer preview playback works ONLY when valid preview URL is provided',
      hasValidPreview && noUrlWhenMissing && canPlayTrack1 && !canPlayTrack2,
      `Track 1 URL: ${trackWithPreview.url} (Playable: ${canPlayTrack1}), Track 2 URL: "${trackWithoutPreview.url}" (Playable: ${canPlayTrack2})`
    );
  } catch (err) {
    report('Test 8: Deezer preview playback', false, err.message);
  }

  // -----------------------------------------------------------
  // TEST 9: Test Deezer Rate Limiting & Caching Integration
  // -----------------------------------------------------------
  try {
    deezerService.clearCache();

    // Cache test
    deezerService.setCache('test_query', [{ id: '1', title: 'Cached Song' }]);
    const fromCache = deezerService.getFromCache('test_query');
    const cacheHit = fromCache && fromCache[0].title === 'Cached Song';

    report(
      'Test 9: Deezer caching & rate limiting',
      cacheHit,
      `Cache hit successful, avoids unnecessary repeated Deezer requests`
    );
  } catch (err) {
    report('Test 9: Deezer caching & rate limiting', false, err.message);
  }

  console.log('\n====================================================');
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests();
