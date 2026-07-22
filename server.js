require('dotenv').config({ quiet: true });
const express = require('express');
const fs = require('fs');
const path = require('path');
const demoData = require('./data/demo.json');

const app = express();
const PORT = process.env.PORT || 5173;
const IS_NETLIFY = Boolean(
  process.env.ECHONOMY_SERVERLESS ||
  process.env.NETLIFY ||
  process.env.AWS_LAMBDA_FUNCTION_NAME
);

const GENIUS_TOKEN = process.env.GENIUS_ACCESS_TOKEN || '';
const SPOTIFY_CLIENT_ID = process.env.SPOTIFY_CLIENT_ID || '';

const CACHE_PATH = path.join(__dirname, 'data', 'cache.json');
let cache = {};
if (!IS_NETLIFY) {
  try { cache = JSON.parse(fs.readFileSync(CACHE_PATH, 'utf8')); } catch { cache = {}; }
}
let cacheDirty = false;
if (!IS_NETLIFY) {
  setInterval(() => {
    if (!cacheDirty) return;
    cacheDirty = false;
    fs.writeFile(CACHE_PATH, JSON.stringify(cache), () => {});
  }, 5000).unref();
}

function cacheKey(artist, title) {
  return `${artist}::${title}`.toLowerCase().replace(/\s+/g, ' ').trim();
}

app.disable('x-powered-by');

// Lightweight abuse guard for public third-party API proxies. Netlify
// instances do not share memory, so provider-level limits still apply.
const rateBuckets = new Map();
function publicApiRateLimit(req, res, next) {
  if (!IS_NETLIFY) return next();
  const now = Date.now();
  const windowMs = 60_000;
  const maxRequests = 90;
  const ip = String(
    req.headers['x-nf-client-connection-ip'] ||
    req.headers['x-forwarded-for'] ||
    req.ip ||
    'unknown'
  ).split(',')[0].trim();
  const bucket = rateBuckets.get(ip);
  if (!bucket || now - bucket.startedAt >= windowMs) {
    rateBuckets.set(ip, { startedAt: now, count: 1 });
    return next();
  }
  bucket.count++;
  if (bucket.count > maxRequests) {
    res.set('Retry-After', String(Math.ceil((windowMs - (now - bucket.startedAt)) / 1000)));
    return res.status(429).json({ error: 'rate limit exceeded; retry shortly' });
  }
  next();
}

if (!IS_NETLIFY) app.use(express.static(path.join(__dirname, 'public')));

// Spotify OAuth redirect lands here; the frontend reads the ?code param.
if (!IS_NETLIFY) {
  app.get('/callback', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
}

app.get('/api/config', (req, res) => {
  res.json({
    spotifyClientId: SPOTIFY_CLIENT_ID || null,
    geniusEnabled: Boolean(GENIUS_TOKEN),
  });
});

app.get('/api/demo', (req, res) => {
  res.json(demoData);
});

// Strip noise that hurts Genius search matching: "(feat. X)", "- Remastered 2011", etc.
function cleanTitle(title) {
  return title
    .replace(/\s*[\(\[][^)\]]*(feat|with|remaster|version|edit|mix|mono|stereo|live|deluxe)[^)\]]*[\)\]]/gi, '')
    .replace(/\s*-\s*(feat|with|remaster|version|edit|mix|mono|stereo|live|single|radio)[^-]*$/gi, '')
    .trim();
}

function normalize(s) {
  return s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim();
}

async function genius(pathname) {
  const r = await fetch(`https://api.genius.com${pathname}`, {
    headers: { Authorization: `Bearer ${GENIUS_TOKEN}` },
  });
  if (!r.ok) throw new Error(`Genius ${r.status} for ${pathname}`);
  return r.json();
}

function mapRelated(rel) {
  return (rel.songs || []).map((s) => ({
    title: s.title,
    artist: s.artist_names || (s.primary_artist && s.primary_artist.name) || '',
    year: s.release_date_components ? s.release_date_components.year : null,
    image: s.song_art_image_thumbnail_url || s.header_image_thumbnail_url || null,
    geniusUrl: s.url || null,
  }));
}

// Look up what a song samples via the Genius API.
// Response: { available, matched: {title, artist, geniusUrl} | null, samples: [], interpolates: [], sampledIn: [] }
app.get('/api/samples', publicApiRateLimit, async (req, res) => {
  const artist = String(req.query.artist || '');
  const title = String(req.query.title || '');
  if (!artist || !title) return res.status(400).json({ error: 'artist and title are required' });
  if (artist.length > 180 || title.length > 180) return res.status(400).json({ error: 'artist or title is too long' });
  if (!GENIUS_TOKEN) return res.json({ available: false, reason: 'no-genius-token' });
  res.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');

  const key = cacheKey(artist, title);
  if (cache[key]) return res.json(cache[key]);

  try {
    const q = encodeURIComponent(`${cleanTitle(title)} ${artist}`);
    const search = await genius(`/search?q=${q}`);
    const hits = (search.response.hits || []).filter((h) => h.type === 'song');

    const wantArtist = normalize(artist);
    const wantTitle = normalize(cleanTitle(title));
    const hit =
      hits.find((h) => {
        const a = normalize(h.result.artist_names || h.result.primary_artist.name);
        const t = normalize(h.result.title);
        return (a.includes(wantArtist) || wantArtist.includes(a)) && (t.includes(wantTitle) || wantTitle.includes(t));
      }) || null;

    if (!hit) {
      const out = { available: true, matched: null, samples: [], interpolates: [], sampledIn: [] };
      cache[key] = out; cacheDirty = true;
      return res.json(out);
    }

    const song = (await genius(`/songs/${hit.result.id}`)).response.song;
    const rels = song.song_relationships || [];
    const byType = (t) => rels.find((r) => (r.relationship_type || r.type) === t) || {};

    const out = {
      available: true,
      matched: {
        title: song.title,
        artist: song.artist_names || (song.primary_artist && song.primary_artist.name) || artist,
        geniusUrl: song.url,
        image: song.song_art_image_thumbnail_url || null,
      },
      samples: mapRelated(byType('samples')),
      interpolates: mapRelated(byType('interpolates')),
      sampledIn: mapRelated(byType('sampled_in')).slice(0, 8),
    };
    cache[key] = out; cacheDirty = true;
    res.json(out);
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

// iTunes Search proxy: 30-second preview clips + artwork for any song, no key needed.
// Response: { found, previewUrl, artworkUrl, itunesTitle, itunesArtist }
app.get('/api/preview', publicApiRateLimit, async (req, res) => {
  const artist = String(req.query.artist || '');
  const title = String(req.query.title || '');
  if (!artist || !title) return res.status(400).json({ error: 'artist and title are required' });
  if (artist.length > 180 || title.length > 180) return res.status(400).json({ error: 'artist or title is too long' });
  res.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');

  // Version the cache whenever matching rules change so stale false positives
  // never survive a deploy (for example a host track featuring the root artist).
  const key = `preview-v2::${cacheKey(artist, title)}`;
  if (cache[key]) return res.json(cache[key]);

  try {
    const wantedTitle = normalize(cleanTitle(title));
    const wantedArtist = normalize(artist);
    const wantedArtistParts = artist
      .split(/,|&|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b/i)
      .map((part) => normalize(part))
      .filter((part) => part.length >= 3);

    const titleMatches = (candidate) => {
      const got = normalize(cleanTitle(candidate.trackName || ''));
      return got === wantedTitle ||
        (wantedTitle.length >= 7 && (got.startsWith(`${wantedTitle} `) || wantedTitle.startsWith(`${got} `)));
    };
    const artistMatches = (candidate) => {
      const got = normalize(candidate.artistName || '');
      return got === wantedArtist || got.includes(wantedArtist) || wantedArtist.includes(got) ||
        wantedArtistParts.some((part) => got === part || got.includes(part));
    };
    const chooseMatch = (results) => (results || [])
      .filter((candidate) => candidate.kind === 'song' && titleMatches(candidate) && artistMatches(candidate))
      .sort((left, right) => {
        const leftScore = (normalize(cleanTitle(left.trackName)) === wantedTitle ? 2 : 0) +
          (normalize(left.artistName) === wantedArtist ? 1 : 0);
        const rightScore = (normalize(cleanTitle(right.trackName)) === wantedTitle ? 2 : 0) +
          (normalize(right.artistName) === wantedArtist ? 1 : 0);
        return rightScore - leftScore;
      })[0] || null;

    const term = encodeURIComponent(`${title} ${artist}`);
    const searchResponse = await fetch(`https://itunes.apple.com/search?term=${term}&entity=song&limit=25`);
    if (!searchResponse.ok) throw new Error(`iTunes ${searchResponse.status}`);
    const search = await searchResponse.json();
    let match = chooseMatch(search.results);

    // iTunes search sometimes ranks a new collaboration above an older solo
    // song even when the older title is exact. Resolve the artist, then search
    // that artist's catalog before giving up.
    if (!match) {
      const primaryArtistName = artist.split(/,|&|\bfeat\.?\b|\bft\.?\b|\bfeaturing\b/i)[0].trim();
      const artistTerm = encodeURIComponent(primaryArtistName);
      const artistResponse = await fetch(`https://itunes.apple.com/search?term=${artistTerm}&entity=musicArtist&limit=10`);
      if (artistResponse.ok) {
        const artistSearch = await artistResponse.json();
        const wantedPrimary = normalize(primaryArtistName);
        const artistHit = (artistSearch.results || []).find((item) => normalize(item.artistName) === wantedPrimary);
        if (artistHit?.artistId) {
          const catalogResponse = await fetch(`https://itunes.apple.com/lookup?id=${artistHit.artistId}&entity=song&limit=200`);
          if (catalogResponse.ok) {
            const catalog = await catalogResponse.json();
            match = chooseMatch(catalog.results);
          }
        }
      }
    }

    const out = match
      ? {
          found: true,
          previewUrl: match.previewUrl || null,
          artworkUrl: (match.artworkUrl100 || '').replace('100x100', '400x400') || null,
          itunesTitle: match.trackName,
          itunesArtist: match.artistName,
        }
      : { found: false };
    cache[key] = out; cacheDirty = true;
    res.json(out);
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
});

if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`ECHONOMY running at http://127.0.0.1:${PORT}`);
    if (!SPOTIFY_CLIENT_ID) console.log('  (no SPOTIFY_CLIENT_ID set - Spotify connect disabled, demo mode works)');
    if (!GENIUS_TOKEN) console.log('  (no GENIUS_ACCESS_TOKEN set - live sample lookups disabled, demo mode works)');
  });
}

module.exports = app;
