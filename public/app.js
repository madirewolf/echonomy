/* ECHONOMY // frontend */

const $ = (sel, el = document) => el.querySelector(sel);
const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

const AUTH_SCOPE_VERSION = 'roots-playlist-v1';
const SCOPES = [
  'user-top-read',
  'playlist-read-private',
  'playlist-read-collaborative',
  'playlist-modify-private',
].join(' ');

const state = {
  config: { spotifyClientId: null, geniusEnabled: false },
  demo: null,
  token: sessionStorage.getItem('pm_token') || null,
  me: null,
  scanning: false,
  creatingPlaylist: false,
  scanResults: [],
  currentSourceLabel: '',
};

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const safeUrl = (u) => (typeof u === 'string' && /^https:\/\//i.test(u) ? u : null);

function show(viewId) {
  $$('.view').forEach((view) => (view.hidden = view.id !== viewId));
  window.scrollTo({ top: 0, behavior: 'instant' });
}

async function boot() {
  const [config, demo] = await Promise.all([
    fetch('/api/config').then((r) => r.json()),
    fetch('/api/demo').then((r) => r.json()).catch(() => null),
  ]);
  state.config = config;
  state.demo = demo;

  buildMarquee();
  $('#cta-demo').addEventListener('click', () => {
    show('view-demo');
    renderDemoFeed();
  });
  $('#home-btn').addEventListener('click', () => show('view-landing'));
  $('#cta-spotify').addEventListener('click', connectSpotify);
  $('#create-roots-playlist').addEventListener('click', createRootsPlaylist);

  const note = $('#hero-note');
  const isPublicDeployment = !['127.0.0.1', 'localhost'].includes(location.hostname);
  if (!config.spotifyClientId) {
    note.textContent = 'OFFLINE // Spotify Client ID missing. Demo protocol remains available.';
  } else if (isPublicDeployment) {
    note.textContent = 'PUBLIC BETA // Demo is open. Spotify scans are limited to allowlisted testers.';
  } else if (config.geniusEnabled) {
    note.textContent = 'SYSTEM READY // Spotify and Genius uplinks detected.';
  } else {
    note.textContent = 'PARTIAL LINK // Spotify ready. Genius sample intelligence is offline.';
  }

  if (location.pathname === '/callback') {
    await handleSpotifyCallback();
    return;
  }

  if (state.token && sessionStorage.getItem('pm_scope_version') !== AUTH_SCOPE_VERSION) {
    sessionStorage.removeItem('pm_token');
    state.token = null;
    note.textContent = 'PERMISSION UPDATE // Reconnect Spotify once to unlock root-playlist compilation.';
  }

  if (state.token) enterLibrary();
}

function buildMarquee() {
  const track = $('#marquee-track');
  const tracks = state.demo?.tracks || [];
  if (!tracks.length) {
    $('.hero-marquee').style.display = 'none';
    return;
  }
  const pairs = tracks.map((t) =>
    `<span class="pair"><strong>${esc(t.title)}</strong><span class="arrow">::DNA::</span>${esc(t.sample_title)} / ${esc(t.sample_artist)}${t.sample_year ? ` / ${t.sample_year}` : ''}</span>`
  );
  track.innerHTML = pairs.join('') + pairs.join('');
}

function ytFacade(videoId, label) {
  if (!videoId) return '<div class="embed"><div class="shroud-hint" style="margin:auto">NO_VIDEO_SIGNAL</div></div>';
  return `
    <div class="embed">
      <button class="yt-facade" data-yt="${esc(videoId)}" data-label="${esc(label)}" aria-label="Play ${esc(label)}"
        style="background-image:url('https://i.ytimg.com/vi/${esc(videoId)}/hqdefault.jpg')">
        <span class="yt-facade-play"><svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg></span>
      </button>
    </div>`;
}

function spotifyEmbed(trackId) {
  return `
    <div class="embed embed--spotify">
      <iframe src="https://open.spotify.com/embed/track/${esc(trackId)}?utm_source=generator&theme=0"
        loading="lazy" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"></iframe>
    </div>`;
}

document.addEventListener('click', (event) => {
  const facade = event.target.closest('.yt-facade');
  if (!facade) return;
  const wrap = facade.closest('.embed');
  const iframe = document.createElement('iframe');
  iframe.src = `https://www.youtube-nocookie.com/embed/${encodeURIComponent(facade.dataset.yt)}?autoplay=1`;
  iframe.title = `YouTube player: ${facade.dataset.label || 'video'}`;
  iframe.allow = 'autoplay; encrypted-media; picture-in-picture';
  iframe.allowFullscreen = true;
  wrap.replaceChildren(iframe);
  iframe.focus();
});

let currentAudio = null;
let previewSeq = 0;

function previewPlayer(idx) {
  return `
    <div class="preview-player" id="pp-${idx}">
      <img class="preview-art" id="pp-art-${idx}" alt="" />
      <button class="preview-btn" id="pp-btn-${idx}" aria-label="Play source preview" disabled>
        <svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>
      </button>
      <div class="preview-info">
        <div class="preview-name" id="pp-name-${idx}">RESOLVING AUDIO SIGNAL...</div>
        <div class="preview-sub">30 SEC / APPLE MUSIC RELAY</div>
        <div class="preview-bar"><div class="preview-bar-fill" id="pp-fill-${idx}"></div></div>
      </div>
    </div>`;
}

async function hydratePreview(idx, artist, title) {
  const btn = $(`#pp-btn-${idx}`);
  const name = $(`#pp-name-${idx}`);
  const art = $(`#pp-art-${idx}`);
  const fill = $(`#pp-fill-${idx}`);
  if (!btn || btn.dataset.hydrated) return;
  btn.dataset.hydrated = 'true';
  try {
    const response = await fetch(`/api/preview?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`);
    const data = await response.json();
    const previewUrl = safeUrl(data.previewUrl);
    if (!data.found || !previewUrl) {
      name.textContent = `${title} / NO PREVIEW FOUND`;
      return;
    }
    name.textContent = `${data.itunesTitle} / ${data.itunesArtist}`;
    const artUrl = safeUrl(data.artworkUrl);
    if (artUrl) art.src = artUrl;
    const audio = new Audio(previewUrl);
    const playSvg = '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>';
    const pauseSvg = '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>';
    btn.disabled = false;
    btn.addEventListener('click', () => {
      if (audio.paused) {
        if (currentAudio && currentAudio !== audio) currentAudio.pause();
        currentAudio = audio;
        audio.play();
        btn.innerHTML = pauseSvg;
      } else {
        audio.pause();
      }
    });
    audio.addEventListener('timeupdate', () => {
      fill.style.width = `${(audio.currentTime / (audio.duration || 30)) * 100}%`;
    });
    audio.addEventListener('pause', () => (btn.innerHTML = playSvg));
    audio.addEventListener('ended', () => {
      btn.innerHTML = playSvg;
      fill.style.width = '0%';
    });
  } catch {
    name.textContent = `${title} / PREVIEW OFFLINE`;
  }
}

const inView = 'IntersectionObserver' in window
  ? new IntersectionObserver(
      (entries) => entries.forEach((entry) => entry.isIntersecting && entry.target.classList.add('in-view')),
      { rootMargin: '-40px' }
    )
  : { observe: (element) => element.classList.add('in-view') };

let specimenSeq = 0;

function normalize(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function primaryArtist(value) {
  return normalize(String(value || '').split(/,|&| feat\.? | ft\.? | featuring /i)[0]);
}

function isSameArtist(left, right) {
  const a = primaryArtist(left);
  const b = primaryArtist(right);
  return Boolean(a && b && (a === b || a.includes(b) || b.includes(a)));
}

function relationshipMeta(kind) {
  if (kind === 'sample') {
    return { tag: 'AUDIO SAMPLE', connector: 'SAMPLED FROM', source: 'SOURCE DNA', chip: 'chip--sample' };
  }
  if (kind === 'self-reference') {
    return { tag: 'SELF-REFERENCE', connector: 'REFERENCES', source: 'INTERNAL ECHO', chip: 'chip--reference' };
  }
  return { tag: 'INTERPOLATION', connector: 'INTERPOLATES', source: 'MELODIC DNA', chip: 'chip--interpolation' };
}

function collectRelationships(data, child) {
  const roots = [];
  const add = (items, baseKind) => {
    (items || []).forEach((item) => {
      const kind = baseKind === 'interpolation' && isSameArtist(child.artist, item.artist)
        ? 'self-reference'
        : baseKind;
      const next = { ...item, kind };
      const key = `${normalize(item.title)}::${normalize(item.artist)}`;
      const existingIndex = roots.findIndex((root) => root.key === key);
      if (existingIndex >= 0) {
        if (kind === 'sample' && roots[existingIndex].kind !== 'sample') roots[existingIndex] = { ...next, key };
        return;
      }
      roots.push({ ...next, key });
    });
  };
  add(data.samples, 'sample');
  add(data.interpolates, 'interpolation');
  return roots;
}

function yearGapText(childYear, rootYear) {
  if (!childYear || !rootYear) return 'DATE UNKNOWN';
  if (rootYear >= childYear) return 'TIMELINE ECHO';
  const gap = childYear - rootYear;
  return `${gap}Y BACKTRACE`;
}

function dnaCard(spec) {
  const caseNumber = String(++specimenSeq).padStart(3, '0');
  const element = document.createElement('article');
  element.className = 'specimen';
  element.id = `case-${caseNumber}`;
  const singleMeta = spec.roots.length === 1 ? relationshipMeta(spec.roots[0].kind) : null;
  const connector = singleMeta ? singleMeta.connector : 'MULTI-ROOT GRAPH';

  const rootHtml = spec.roots.map((root, index) => {
    const meta = relationshipMeta(root.kind);
    const link = safeUrl(root.link);
    return `
      <section class="root-node" data-relation="${esc(root.kind)}" data-node="NODE_${String(index + 1).padStart(2, '0')}">
        <div class="track-meta">
          <span class="chip ${meta.chip}">${meta.tag}</span>
          <span class="chip">${root.year ? esc(root.year) : 'YEAR_NA'}</span>
          ${root.element ? `<span class="chip">${esc(root.element)}</span>` : ''}
        </div>
        <div>
          <h3 class="track-title">${esc(root.title)}</h3>
          <p class="track-artist">${esc(root.artist)}${link ? ` / <a href="${esc(link)}" target="_blank" rel="noopener">VERIFY DATA</a>` : ''}</p>
        </div>
        ${root.embedHtml || ''}
        ${root.story ? `<p class="track-story">${esc(root.story)}</p>` : ''}
      </section>`;
  }).join('');

  element.innerHTML = `
    <header class="case-head">
      <span>CASE_FILE <strong>#${caseNumber}</strong> / ${esc(spec.child.title)}</span>
      <span class="case-nodes">${spec.roots.length} DNA_NODE${spec.roots.length === 1 ? '' : 'S'} DETECTED</span>
    </header>
    <div class="specimen-grid">
      <section class="track track--child">
        <div class="track-meta">
          <span class="chip">${spec.child.year ? esc(spec.child.year) : 'DATE_NA'}</span>
          <span class="chip chip--accent">HOST TRACK</span>
        </div>
        <div>
          <h3 class="track-title">${esc(spec.child.title)}</h3>
          <p class="track-artist">${esc(spec.child.artist)}</p>
        </div>
        ${spec.child.embedHtml}
      </section>

      <div class="lineage" aria-hidden="true">
        <span class="lineage-label">${esc(connector)}</span>
        <div class="lineage-core"><span></span></div>
        <span class="lineage-gap">${esc(yearGapText(spec.child.year, spec.roots[0]?.year))}</span>
      </div>

      <div class="root-zone">
        <div class="root-shroud">
          <span class="shroud-virus"><i></i><i></i><i></i></span>
          <p class="shroud-hint">${spec.roots.length} ENCRYPTED ROOT NODE${spec.roots.length === 1 ? '' : 'S'} FOUND IN WAVEFORM</p>
          <button class="btn btn--toxic btn--small reveal-cta">DECRYPT ${spec.roots.length === 1 ? 'SOURCE' : `${spec.roots.length} ROOTS`}</button>
        </div>
        <div class="root-list ${spec.roots.length === 1 ? 'root-list--single' : ''}">${rootHtml}</div>
      </div>
    </div>`;

  element.querySelector('.reveal-cta').addEventListener('click', (event) => {
    if (element.classList.contains('revealed')) return;
    element.classList.add('revealed');
    event.currentTarget.blur();
    spec.roots.forEach((root) => root.hydrate?.());
  });

  inView.observe(element);
  return element;
}

let demoRendered = false;

function renderDemoFeed() {
  if (demoRendered) return;
  demoRendered = true;
  const feed = $('#demo-feed');
  (state.demo?.tracks || []).forEach((track) => {
    const kind = /interpolat/i.test(track.element || '') ? 'interpolation' : 'sample';
    feed.appendChild(dnaCard({
      child: {
        title: track.title,
        artist: track.artist,
        year: track.year,
        embedHtml: track.youtube_id_track
          ? ytFacade(track.youtube_id_track, track.title)
          : track.spotify_track_id
            ? spotifyEmbed(track.spotify_track_id)
            : ytFacade('', track.title),
      },
      roots: [{
        title: track.sample_title,
        artist: track.sample_artist,
        year: track.sample_year,
        kind,
        element: track.element,
        story: track.story,
        embedHtml: ytFacade(track.youtube_id_sample, track.sample_title),
      }],
    }));
  });
}

function b64url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function connectSpotify() {
  if (!state.config.spotifyClientId) {
    alert('Spotify Client ID is missing. Add SPOTIFY_CLIENT_ID to .env and restart the server.');
    return;
  }
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  sessionStorage.setItem('pm_verifier', verifier);
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  const params = new URLSearchParams({
    client_id: state.config.spotifyClientId,
    response_type: 'code',
    redirect_uri: `${location.origin}/callback`,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge,
    show_dialog: 'true',
  });
  location.href = `https://accounts.spotify.com/authorize?${params}`;
}

async function handleSpotifyCallback() {
  const query = new URLSearchParams(location.search);
  const code = query.get('code');
  const authError = query.get('error');
  history.replaceState({}, '', '/');
  if (authError) {
    $('#hero-note').textContent = `SPOTIFY AUTH ABORTED // ${authError}`;
    return;
  }
  const verifier = sessionStorage.getItem('pm_verifier');
  if (!code || !verifier) return;
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: state.config.spotifyClientId,
      grant_type: 'authorization_code',
      code,
      redirect_uri: `${location.origin}/callback`,
      code_verifier: verifier,
    }),
  });
  if (!response.ok) {
    alert(`Spotify sign-in failed. Confirm the redirect URI is exactly ${location.origin}/callback`);
    return;
  }
  const data = await response.json();
  state.token = data.access_token;
  sessionStorage.setItem('pm_token', state.token);
  sessionStorage.setItem('pm_scope_version', AUTH_SCOPE_VERSION);
  sessionStorage.removeItem('pm_verifier');
  enterLibrary();
}

async function spotifyRequest(path, options = {}) {
  const response = await fetch(`https://api.spotify.com/v1${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${state.token}`,
      ...(options.headers || {}),
    },
  });
  if (response.status === 401) {
    sessionStorage.removeItem('pm_token');
    state.token = null;
    $('#head-right').innerHTML = '';
    show('view-landing');
    $('#hero-note').textContent = 'SESSION EXPIRED // Reconnect Spotify to resume tracing.';
    throw new Error('Spotify session expired. Connect again.');
  }
  if (response.status === 429) {
    const wait = Math.max(1, Number(response.headers.get('Retry-After') || 2));
    await new Promise((resolve) => setTimeout(resolve, (wait + 0.25) * 1000));
    return spotifyRequest(path, options);
  }
  if (!response.ok) {
    let detail = '';
    try {
      const payload = await response.json();
      detail = payload?.error?.message || payload?.error || '';
    } catch {}
    const error = new Error(`Spotify ${response.status}${detail ? `: ${detail}` : ''}`);
    error.status = response.status;
    throw error;
  }
  if (response.status === 204) return null;
  return response.json();
}

const spotifyGet = (path) => spotifyRequest(path);

async function enterLibrary() {
  show('view-library');
  try {
    state.me = await spotifyGet('/me');
  } catch {
    return;
  }

  const profileImage = safeUrl(state.me.images?.[0]?.url);
  $('#head-right').innerHTML = `
    ${profileImage ? `<img src="${esc(profileImage)}" alt="" />` : ''}
    <span>${esc(state.me.display_name || '')}</span>
    <button class="btn btn--ghost btn--small" id="logout-btn">LOG OUT</button>`;
  $('#logout-btn').addEventListener('click', () => {
    sessionStorage.removeItem('pm_token');
    sessionStorage.removeItem('pm_scope_version');
    location.href = '/';
  });

  const firstName = state.me.display_name?.split(' ')[0] || 'OPERATOR';
  $('#library-title').textContent = `WELCOME, ${firstName.toUpperCase()}.`;
  $('#library-sub').textContent = 'Choose a playlist host. The scanner will map every known sample and interpolation without collapsing multiple roots.';

  const picker = $('#source-picker');
  picker.innerHTML = '<button class="source-pill" data-source="top" data-label="Top Tracks">TOP TRACKS / 6 MONTHS</button>';
  try {
    const playlists = await spotifyGet('/me/playlists?limit=50');
    (playlists.items || []).forEach((playlist) => {
      if (!playlist) return;
      const total = playlist.tracks?.total ?? playlist.items?.total ?? 0;
      if (!total) return;
      const readable = playlist.owner?.id === state.me.id || playlist.collaborative;
      if (!readable) return;
      const button = document.createElement('button');
      button.className = 'source-pill';
      button.dataset.source = `playlist:${playlist.id}`;
      button.dataset.label = playlist.name;
      button.textContent = `${playlist.name.toUpperCase()} / ${total} TRACKS`;
      picker.appendChild(button);
    });
  } catch {}

  picker.addEventListener('click', (event) => {
    const pill = event.target.closest('.source-pill');
    if (!pill || state.scanning) return;
    $$('.source-pill', picker).forEach((item) => item.classList.toggle('active', item === pill));
    scanSource(pill.dataset.source, pill.dataset.label || 'Spotify Source');
  });
}

async function fetchSourceTracks(source) {
  if (source === 'top') {
    const data = await spotifyGet('/me/top/tracks?limit=50&time_range=medium_term');
    return (data.items || []).map(trackShape);
  }
  const id = source.split(':')[1];
  const output = [];
  let url = `/playlists/${id}/items?limit=50`;
  let triedFallback = false;
  while (url && output.length < 300) {
    let data;
    try {
      data = await spotifyGet(url);
    } catch (error) {
      if (!triedFallback && url.includes('/items')) {
        triedFallback = true;
        url = url.replace('/items', '/tracks');
        continue;
      }
      if (error.message?.includes('expired')) throw error;
      throw new Error('Spotify will only expose playlists you own or collaborate on.');
    }
    (data.items || []).forEach((item) => {
      const track = item?.track || item?.item;
      if (track?.id) output.push(trackShape(track));
    });
    url = data.next ? data.next.replace('https://api.spotify.com/v1', '') : null;
  }
  return output;
}

function trackShape(track) {
  return {
    id: track.id,
    title: track.name,
    artist: (track.artists || []).map((artist) => artist.name).join(', '),
    year: track.album?.release_date ? Number(track.album.release_date.slice(0, 4)) : null,
    art: safeUrl(track.album?.images?.[2]?.url || track.album?.images?.[0]?.url),
  };
}

async function scanSource(source, sourceLabel) {
  state.scanning = true;
  state.scanResults = [];
  state.currentSourceLabel = sourceLabel;
  const feed = $('#library-feed');
  const rest = $('#library-rest');
  const forge = $('#playlist-forge');
  const bar = $('#scanbar');
  const fill = $('#scanbar-fill');
  const label = $('#scanbar-label');
  feed.innerHTML = '';
  rest.innerHTML = '';
  forge.hidden = true;
  $('#forge-status').textContent = '';
  fill.style.width = '0%';
  bar.hidden = false;

  if (!state.config.geniusEnabled) {
    bar.hidden = true;
    feed.innerHTML = '<p class="empty-note">GENIUS_LINK OFFLINE // Add <code>GENIUS_ACCESS_TOKEN</code> to <code>.env</code>, restart, and try again.</p>';
    state.scanning = false;
    return;
  }

  let tracks;
  try {
    label.textContent = 'ACQUIRING SPOTIFY TRACK MANIFEST...';
    tracks = await fetchSourceTracks(source);
  } catch (error) {
    label.textContent = `SCAN ABORTED // ${error.message || 'TRACK ACCESS FAILED'}`;
    state.scanning = false;
    return;
  }

  if (!tracks.length) {
    label.textContent = 'SCAN COMPLETE // NO TRACKS IN HOST';
    state.scanning = false;
    return;
  }

  let done = 0;
  let foundTracks = 0;
  let relationshipCount = 0;
  const noRoots = [];
  const queue = [...tracks];

  const workers = Array.from({ length: 3 }, async () => {
    while (queue.length) {
      const track = queue.shift();
      try {
        const response = await fetch(`/api/samples?artist=${encodeURIComponent(track.artist)}&title=${encodeURIComponent(track.title)}`);
        const data = await response.json();
        const relationships = collectRelationships(data, track);
        if (relationships.length) {
          foundTracks++;
          relationshipCount += relationships.length;
          state.scanResults.push({ track, roots: relationships });
          const roots = relationships.map((root) => {
            const previewId = previewSeq++;
            return {
              ...root,
              link: root.geniusUrl,
              embedHtml: previewPlayer(previewId),
              hydrate: () => hydratePreview(previewId, root.artist, root.title),
            };
          });
          feed.appendChild(dnaCard({
            child: { title: track.title, artist: track.artist, year: track.year, embedHtml: spotifyEmbed(track.id) },
            roots,
          }));
        } else {
          noRoots.push(track);
        }
      } catch {
        noRoots.push(track);
      }
      done++;
      fill.style.width = `${(done / tracks.length) * 100}%`;
      label.textContent = `TRACE ${done}/${tracks.length} // ${relationshipCount} DNA NODE${relationshipCount === 1 ? '' : 'S'} FOUND`;
    }
  });
  await Promise.all(workers);

  label.textContent = relationshipCount
    ? `SCAN COMPLETE // ${relationshipCount} ROOTS ACROSS ${foundTracks}/${tracks.length} TRACKS`
    : 'SCAN COMPLETE // NO COMMUNITY-MAPPED ROOTS FOUND';

  configurePlaylistForge();

  if (noRoots.length && foundTracks) {
    rest.innerHTML = '<p class="rest-head">NULL_RESULTS // NO KNOWN ROOTS YET</p>' +
      noRoots.slice(0, 40).map((track) => `
        <div class="rest-row">
          ${track.art ? `<img src="${esc(track.art)}" alt="" />` : '<span></span>'}
          <span class="rest-title">${esc(track.title)}</span>
          <span>${esc(track.artist)}</span>
        </div>`).join('');
  }
  state.scanning = false;
}

function uniqueActualSampleRoots() {
  const unique = new Map();
  state.scanResults.forEach((result) => {
    result.roots.filter((root) => root.kind === 'sample').forEach((root) => {
      const key = `${normalize(root.title)}::${normalize(root.artist)}`;
      if (!unique.has(key)) unique.set(key, root);
    });
  });
  return [...unique.values()];
}

function configurePlaylistForge() {
  const forge = $('#playlist-forge');
  const button = $('#create-roots-playlist');
  const roots = uniqueActualSampleRoots();
  forge.hidden = false;
  $('#forge-count').textContent = `${roots.length} UNIQUE SAMPLE ROOT${roots.length === 1 ? '' : 'S'}`;
  $('#forge-title').textContent = roots.length
    ? `Compile the source DNA from ${state.currentSourceLabel}.`
    : 'No literal samples found in this scan.';
  $('#forge-copy').textContent = roots.length
    ? 'Actual audio samples only. Interpolations and same-artist references are excluded.'
    : 'The relationship cards may still contain interpolations or self-references, but those are not sample sources.';
  button.disabled = roots.length === 0;
  button.textContent = 'COMPILE TO SPOTIFY';
}

function spotifyTrackScore(candidate, root) {
  const wantedTitle = normalize(root.title);
  const gotTitle = normalize(candidate.name);
  const wantedArtist = primaryArtist(root.artist);
  const candidateArtists = (candidate.artists || []).map((artist) => normalize(artist.name));
  let score = 0;
  if (gotTitle === wantedTitle) score += 6;
  else if (gotTitle.includes(wantedTitle) || wantedTitle.includes(gotTitle)) score += 3;
  if (candidateArtists.some((artist) => artist === wantedArtist)) score += 5;
  else if (candidateArtists.some((artist) => artist.includes(wantedArtist) || wantedArtist.includes(artist))) score += 3;
  return score;
}

async function findSpotifyRoot(root) {
  const query = encodeURIComponent(`track:${root.title} artist:${root.artist}`);
  const data = await spotifyGet(`/search?type=track&limit=5&q=${query}`);
  const candidates = data.tracks?.items || [];
  const ranked = candidates
    .map((track) => ({ track, score: spotifyTrackScore(track, root) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.score >= 7 ? ranked[0].track : null;
}

async function createRootsPlaylist() {
  if (state.creatingPlaylist) return;
  const roots = uniqueActualSampleRoots();
  if (!roots.length || !state.me) return;
  state.creatingPlaylist = true;
  const button = $('#create-roots-playlist');
  const status = $('#forge-status');
  button.disabled = true;
  button.textContent = 'COMPILING...';

  try {
    const queue = [...roots];
    const matches = [];
    let resolved = 0;
    const workers = Array.from({ length: 3 }, async () => {
      while (queue.length) {
        const root = queue.shift();
        const match = await findSpotifyRoot(root).catch(() => null);
        if (match?.uri) matches.push(match);
        resolved++;
        status.textContent = `RESOLVING ROOTS ON SPOTIFY // ${resolved}/${roots.length}`;
      }
    });
    await Promise.all(workers);

    const uris = [...new Set(matches.map((track) => track.uri))];
    if (!uris.length) throw new Error('No source tracks could be matched confidently on Spotify.');

    status.textContent = `CREATING PRIVATE PLAYLIST // ${uris.length} MATCHED ROOTS`;
    const sourceName = state.currentSourceLabel || 'Your Library';
    const playlist = await spotifyRequest('/me/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: `ECHONOMY ROOTS // ${sourceName}`.slice(0, 100),
        description: `Sample roots traced through ${sourceName} by ECHONOMY. Literal samples only; interpolations excluded.`.slice(0, 300),
        public: false,
      }),
    });

    for (let index = 0; index < uris.length; index += 100) {
      const body = JSON.stringify({ uris: uris.slice(index, index + 100) });
      await spotifyRequest(`/playlists/${playlist.id}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
    }

    const playlistUrl = safeUrl(playlist.external_urls?.spotify);
    status.innerHTML = `COMPILE COMPLETE // ${uris.length}/${roots.length} ROOTS ADDED${playlistUrl ? ` // <a href="${esc(playlistUrl)}" target="_blank" rel="noopener">OPEN PLAYLIST</a>` : ''}`;
    button.textContent = 'PLAYLIST COMPILED';
  } catch (error) {
    status.textContent = error.status === 403
      ? 'PERMISSION DENIED // Log out, reconnect Spotify, and approve playlist access.'
      : `COMPILE FAILED // ${error.message || 'UNKNOWN ERROR'}`;
    button.disabled = false;
    button.textContent = 'RETRY COMPILE';
  } finally {
    state.creatingPlaylist = false;
  }
}

boot();
