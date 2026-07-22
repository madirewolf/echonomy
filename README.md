# ECHONOMY ◐

**Every song you love is haunted by another.**

Live at <https://echonomy.limiliminal.com>.

Connect your Spotify and meet the originals hiding inside your favorite tracks —
the drum breaks, vocal hooks, and forgotten records that became the songs you
can't stop playing. Inspired by that feeling of looking up the sample in
Fred again..'s *Cmon Home* and hearing where it came from.

## Run it

```bash
npm install
npm start
# open http://127.0.0.1:5173
```

**Demo mode works immediately, zero setup** — a hand-curated crate of iconic
sample relationships with side-by-side playback.

## Unlock "Connect Spotify" (~3 min, free)

1. Go to <https://developer.spotify.com/dashboard> → **Create app**.
2. Set the **Redirect URI** to exactly `http://127.0.0.1:5173/callback`
   (Spotify requires the loopback IP `127.0.0.1`, not `localhost`).
3. Check **Web API**, save, and copy the **Client ID**.
4. `copy .env.example .env` and paste the ID into `SPOTIFY_CLIENT_ID`.
5. Restart the server, open **http://127.0.0.1:5173** (use the 127.0.0.1 URL,
   not localhost, so the redirect matches), hit **Connect Spotify**.

Spotify tightened Development Mode hard in **February 2026**: apps are capped
at **5 allowlisted users**, you get **one Client ID** per account, and the app
owner must keep an active **Spotify Premium** subscription or the app stops
working. You're allowlisted automatically as the owner; add up to 4 friends
under **User Management** (exact Spotify account email required — non-listed
users get 403s after login). Also: new apps can only read the contents of
playlists you **own or collaborate on** — followed/editorial playlists list
but won't scan.

## Unlock live sample lookups (~2 min, free)

Scanning your real library needs sample data. That comes from the
[Genius API](https://genius.com/api-clients)'s community-maintained song
relationships:

1. Create an API client (any app name/URL) → **Generate Access Token**
   (the *client access token* is enough — no user OAuth needed).
2. Put it in `.env` as `GENIUS_ACCESS_TOKEN` and restart.

## Compile a roots playlist

After a scan, **Compile to Spotify** creates a private playlist containing every
unique source track that Spotify can match confidently. It includes literal
audio samples only; interpolations and same-artist self-references remain visible
in the DNA graph but are excluded from the generated playlist.

The Spotify login requests `playlist-modify-private` for this feature. If you
connected before the compiler was added, reconnect once to approve the new scope.

## How it works

```
Browser ── Spotify OAuth (PKCE, client-side) ──> your playlists & top tracks
   │
   ├─ /api/samples ──> Genius search + song_relationships (server proxy, cached in data/cache.json)
   ├─ /api/preview ──> iTunes Search API 30s preview clips for the originals (keyless)
   └─ playback: YouTube & Spotify official embeds — no audio is re-hosted
```

- `server.js` — small Express server: static files + API proxies + disk cache
- `public/` — vanilla JS frontend (no build step)
- `data/demo.json` — the curated demo crate

## Honest limitations

- Sample coverage comes from the Genius community; it's deepest for hip-hop,
  pop, and dance. WhoSampled has far richer data (~622K samples) but no public
  API, bans scraping — and **Spotify acquired it in Nov 2025**, so licensing is
  effectively closed. MusicBrainz (CC0, ~228K sample/remix links) is the open
  fallback worth adding next.
- Spotify tokens expire after 1 hour (no refresh flow yet — just reconnect).
- iTunes previews are 30 seconds (~20 requests/min/IP — previews load lazily
  on reveal to stay under this); YouTube embeds obey each video's embed
  permissions and region rules.
- Genius's `song_relationships` field is undocumented-but-stable; the free
  token is for non-commercial use.

## Where this can go (what the research says)

Spotify shipped **SongDNA** (Apr 2026, Premium-only, powered by WhoSampled) —
per-track sample lookup inside Spotify. The WhoSampled app has scanned Spotify
libraries since 2016 and is now free. So the *per-track* version of this idea
is commoditized. What nobody does — and where ECHONOMY should aim — is
the **aggregate story of a person's taste**: "40% of your library descends
from 1970s soul," a family tree of your top 50, ancestor playlists ("listen to
your library's parents"), shareable Wrapped-style lineage cards, works on any
platform (SongDNA is Spotify-Premium-only). The encyclopedia exists; the
*mirror* doesn't.
