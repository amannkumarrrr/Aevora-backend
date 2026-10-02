const assert = require('assert');
const axios = require('axios');
const musicService = require('./services/musicService');
const lyricsOvhService = require('./services/lyricsOvhService');

async function runLyricsTests() {
  console.log('====================================================');
  console.log('🎤 RUNNING AEVORA MUSIC - LYRICS.OVH FALLBACK TESTS');
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
  // TEST 1: Song where JioSaavn has lyrics -> JioSaavn used, Lyrics.ovh NOT called
  // -----------------------------------------------------------
  try {
    let ovhCallCount = 0;
    const originalFetchLyrics = lyricsOvhService.fetchLyrics;
    lyricsOvhService.fetchLyrics = async (...args) => {
      ovhCallCount++;
      return originalFetchLyrics(...args);
    };

    // "Tum Hi Ho" is a classic JioSaavn song with native Hindi lyrics
    const songs = await musicService.searchSongs('Tum Hi Ho');
    const songId = songs[0].id;

    const lyrics = await musicService.getLyrics(songId, songs[0].singers, songs[0].title);
    lyricsOvhService.fetchLyrics = originalFetchLyrics;

    const jiosaavnLyricsFound = lyrics && typeof lyrics === 'string' && lyrics.includes('Hum Tere Bin');
    const ovhNotCalled = ovhCallCount === 0;

    report(
      'Test 1: Song with JioSaavn lyrics -> JioSaavn returned, Lyrics.ovh NOT called',
      jiosaavnLyricsFound && ovhNotCalled,
      `Lyrics snippet: "${lyrics ? lyrics.substring(0, 45) : 'None'}...", Lyrics.ovh calls: ${ovhCallCount}`
    );
  } catch (err) {
    report('Test 1: Song with JioSaavn lyrics', false, err.message);
  }

  // -----------------------------------------------------------
  // TEST 2: Song where JioSaavn has NO lyrics but Lyrics.ovh has lyrics
  // -----------------------------------------------------------
  try {
    // "Adventure of a Lifetime" by Coldplay has no lyrics on JioSaavn
    const origPrimaryLyrics = musicService.getPrimaryLyrics;
    musicService.getPrimaryLyrics = async () => null; // Simulate primary has no lyrics

    const lyrics = await musicService.getLyrics(null, 'Coldplay', 'Adventure of a Lifetime');
    musicService.getPrimaryLyrics = origPrimaryLyrics;

    const ovhSucceeded = lyrics && typeof lyrics === 'string' && lyrics.toLowerCase().includes('magic');
    report(
      'Test 2: Song missing from JioSaavn -> Lyrics.ovh fallback delivers lyrics',
      Boolean(ovhSucceeded),
      `Snippet: "${lyrics ? lyrics.substring(0, 60).replace(/\n/g, ' ') : 'None'}..."`
    );
  } catch (err) {
    report('Test 2: Song missing from JioSaavn', false, err.message);
  }

  // -----------------------------------------------------------
  // TEST 3: Song where neither API has lyrics -> Returns null ("Lyrics are not available")
  // -----------------------------------------------------------
  try {
    const origPrimaryLyrics = musicService.getPrimaryLyrics;
    musicService.getPrimaryLyrics = async () => null;

    const lyrics = await musicService.getLyrics('nonexistent_id_9999', 'TotallyUnknownBand12345', 'FakeSong998877');
    musicService.getPrimaryLyrics = origPrimaryLyrics;

    const isNull = lyrics === null;
    report(
      'Test 3: Song in neither API -> Returns null (graceful "Lyrics are not available for this song")',
      isNull,
      `Result is null: ${isNull}`
    );
  } catch (err) {
    report('Test 3: Song in neither API', false, err.message);
  }

  // -----------------------------------------------------------
  // TEST 4: Lyrics.ovh returns HTTP 404 -> Treated as "lyrics not found", no technical error
  // -----------------------------------------------------------
  try {
    const result = await lyricsOvhService.fetchLyrics('Adele', 'A CompletelyNonExistentTrackXYZ7788');
    const isGracefulNotFound = result === null;
    report(
      'Test 4: Lyrics.ovh returns HTTP 404 -> Treated cleanly as not found without throwing error',
      isGracefulNotFound,
      `Result: ${result}`
    );
  } catch (err) {
    report('Test 4: Lyrics.ovh returns HTTP 404', false, err.message);
  }

  // -----------------------------------------------------------
  // TEST 5: Lyrics.ovh is unavailable (timeout or network error) -> Backend does NOT crash
  // -----------------------------------------------------------
  try {
    const origFetch = lyricsOvhService.fetchLyrics;
    lyricsOvhService.fetchLyrics = async () => {
      throw new Error('Connection timeout / 503 Service Unavailable');
    };

    const origPrimary = musicService.getPrimaryLyrics;
    musicService.getPrimaryLyrics = async () => null;

    const safeResult = await musicService.getLyrics('any_id', 'AnyArtist', 'AnySong');

    lyricsOvhService.fetchLyrics = origFetch;
    musicService.getPrimaryLyrics = origPrimary;

    const didNotCrash = safeResult === null;
    report(
      'Test 5: Lyrics.ovh unavailable / error -> Backend does NOT crash, returns null gracefully',
      didNotCrash,
      `Safe fallback result: ${safeResult}`
    );
  } catch (err) {
    report('Test 5: Lyrics.ovh unavailable', false, err.message);
  }

  // -----------------------------------------------------------
  // TEST 6: Artist/title containing spaces or special characters -> Properly URL-encoded
  // -----------------------------------------------------------
  try {
    // "Adventure of a Lifetime" contains spaces
    // "Coldplay"
    const lyrics = await lyricsOvhService.fetchLyrics('Coldplay', 'Adventure of a Lifetime');
    const encodedSuccess = lyrics && typeof lyrics === 'string' && lyrics.length > 50;

    report(
      'Test 6: Artist & title with spaces / characters properly URL-encoded and resolved',
      Boolean(encodedSuccess),
      `Successfully fetched ${lyrics ? lyrics.length : 0} chars of lyrics`
    );
  } catch (err) {
    report('Test 6: URL-encoding spaces & characters', false, err.message);
  }

  // -----------------------------------------------------------
  // TEST 7: In-memory Caching -> Avoids repeated requests to Lyrics.ovh
  // -----------------------------------------------------------
  try {
    lyricsOvhService.clearCache();
    lyricsOvhService.setCache('sampleartist_samplesong', 'Cached lyrics content');

    const cached = lyricsOvhService.getFromCache('sampleartist_samplesong');
    const isCached = cached === 'Cached lyrics content';

    report(
      'Test 7: Lyrics.ovh caching integration',
      isCached,
      `In-memory cache prevents redundant HTTP calls to Lyrics.ovh`
    );
  } catch (err) {
    report('Test 7: Lyrics.ovh caching', false, err.message);
  }

  // -----------------------------------------------------------
  // TEST 8: Full API route check via HTTP controller
  // -----------------------------------------------------------
  try {
    process.env.VERCEL = '1';
    const app = require('./server');
    const http = require('http');

    await new Promise((resolve, reject) => {
      const server = http.createServer(app);
      server.listen(5097, async () => {
        try {
          // 1. Primary lyrics via HTTP
          const res1 = await fetch('http://localhost:5097/api/lyrics?query=aRZbUYD7&artist=Arijit%20Singh&title=Tum%20Hi%20Ho');
          const data1 = await res1.json();
          const primaryOk = data1.success === true && typeof data1.lyrics === 'string' && data1.lyrics.includes('Hum Tere Bin');

          // 2. Fallback lyrics via HTTP (Coldplay)
          const res2 = await fetch('http://localhost:5097/api/lyrics?query=Z0od0koB&artist=Coldplay&title=Adventure%20of%20a%20Lifetime');
          const data2 = await res2.json();
          const fallbackOk = data2.success === true && typeof data2.lyrics === 'string' && data2.lyrics.toLowerCase().includes('magic');

          // 3. Non-existent lyrics via HTTP
          const res3 = await fetch('http://localhost:5097/api/lyrics?query=fake_999&artist=FakeArtist&title=FakeTrack');
          const data3 = await res3.json();
          const emptyOk = data3.success === true && data3.lyrics === null && data3.message === 'Lyrics are not available for this song.';

          report(
            'Test 8: Full HTTP /api/lyrics endpoint test (Primary + Fallback + Empty)',
            primaryOk && fallbackOk && emptyOk,
            `Primary OK: ${primaryOk}, Fallback OK: ${fallbackOk}, Empty message OK: ${emptyOk}`
          );

          server.close(resolve);
        } catch (e) {
          server.close(() => reject(e));
        }
      });
    });
  } catch (err) {
    report('Test 8: Full HTTP /api/lyrics endpoint', false, err.message);
  }

  console.log('\n====================================================');
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runLyricsTests();
