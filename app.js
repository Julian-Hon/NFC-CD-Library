const VIEW_KEY = 'digital-cd-library:view:v2';
const MOTION_KEY = 'digital-cd-library:motion:v1';
const MUSICBRAINZ = 'https://musicbrainz.org/ws/2';
const COVER_ART = 'https://coverartarchive.org';

const dialog = document.querySelector('#cd-dialog');
const searchForm = document.querySelector('#search-form');
const status = document.querySelector('#search-status');
const results = document.querySelector('#search-results');
const grid = document.querySelector('#album-grid');
const stackView = document.querySelector('#stack-view');
const stack = document.querySelector('#cd-stack');
const state = { query: '', selectedId: null, filtered: [], stackCds: [], stackPage: 0, favoriteBusy: false, cds: [], accountUserId: null, cloudRequest: 0, scanBusy: false, selected: null, mode: 'new', view: loadView(), animateStack: loadMotion(), activeIndex: 0, lastRequestAt: 0, bridge: false, pendingUid: null, lastScanId: 0, currentScan: null };
const requestCache = new Map();
let requestQueue = Promise.resolve();
let scanToastTimer;

function showScanToast(message) {
  const toast = document.querySelector('#scan-toast');
  clearTimeout(scanToastTimer);
  toast.textContent = message;
  toast.hidden = false;
  scanToastTimer = setTimeout(() => { toast.hidden = true; }, 3500);
}

function loadView() {
  try {
    const view = localStorage.getItem(VIEW_KEY);
    return ['stack', 'grid', 'artists', 'genres', 'years'].includes(view) ? view : 'stack';
  } catch {
    return 'stack';
  }
}

function loadMotion() {
  try {
    return localStorage.getItem(MOTION_KEY) !== 'off';
  } catch {
    return true;
  }
}

function updateStackMotion() {
  stackView.classList.toggle('motion-off', !state.animateStack);
  window.CDStack3D?.setMotion(state.animateStack);
  const button = document.querySelector('#stack-motion');
  button.setAttribute('aria-pressed', String(state.animateStack));
  button.textContent = state.animateStack ? 'Animation on' : 'Animation off';
}

function setView(view) {
  if (!['stack', 'grid', 'artists', 'genres', 'years'].includes(view)) return;
  state.view = view;
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Browsing still works when storage is unavailable.
  }
  renderLibrary();
}

function setLibraryStatus(message, isError = false) {
  const element = document.querySelector('#library-status');
  element.textContent = message;
  element.classList.toggle('error', isError);
}

async function loadAccountLibrary() {
  const auth = window.cdLibraryAuth;
  if (!auth?.user) return;
  const userId = auth.user.id;
  const request = ++state.cloudRequest;
  setLibraryStatus('Loading your library…');
  document.querySelector('#add-cd').disabled = true;
  try {
    const { data, error } = await auth.client.from('cds').select('payload').order('created_at', { ascending: false });
    if (error) throw error;
    if (request !== state.cloudRequest || window.cdLibraryAuth?.user?.id !== userId) return;
    state.cds = data.map(row => row.payload);
    renderLibrary();
    setLibraryStatus('');
  } catch (error) {
    if (request === state.cloudRequest) {
      setLibraryStatus(`Could not load your library: ${error.message}`, true);
    }
  } finally {
    if (request === state.cloudRequest) document.querySelector('#add-cd').disabled = false;
  }
}

function onAuthChange() {
  const user = window.cdLibraryAuth?.user;
  if (!user) {
    state.accountUserId = null;
    state.cloudRequest++;
    state.cds = [];
    state.selectedId = null;
    state.query = '';
    document.querySelector('#collection-search').value = '';
    state.currentScan = null;
    state.pendingUid = null;
    state.lastScanId = 0;
    if (dialog.open) dialog.close();
    document.querySelector('#scan-panel').hidden = true;
    document.querySelector('#add-cd').disabled = false;
    setLibraryStatus('');
    renderLibrary();
  } else if (state.accountUserId !== user.id) {
    state.accountUserId = user.id;
    state.cds = [];
    state.lastScanId = 0;
    document.querySelector('#scan-panel').hidden = !state.bridge;
    void loadAccountLibrary();
  }
}

async function bridgeRequest(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...options.headers }
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'The local NFC bridge could not save this CD.');
  return data;
}

function renderScan(scan, cd = null) {
  state.currentScan = scan;
  const title = document.querySelector('#scan-title');
  const description = document.querySelector('#scan-description');
  const action = document.querySelector('#scan-action');
  action.hidden = !scan;
  action.onclick = null;
  if (!scan) {
    title.textContent = 'Waiting for a CD scan';
    description.textContent = 'Hold a tagged CD case near the red reader.';
  } else if (cd) {
    title.textContent = cd.album;
    description.textContent = `${cd.artist} · Tag ${scan.uid}`;
    action.textContent = 'View CD';
    action.onclick = () => showDetails(cd, 'saved');
  } else {
    title.textContent = 'New tag detected';
    description.textContent = scan.cd
      ? `Tag ${scan.uid} still has a local ESP32 link to ${scan.cd.album}. Link it to your account to use it here.`
      : `Tag ${scan.uid} is ready to link to your account.`;
    action.textContent = 'Link a CD';
    action.onclick = () => openAdd(scan.uid);
  }
}

async function pollLatestScan() {
  if (state.scanBusy) return;
  state.scanBusy = true;
  try {
    const { scan, reader } = await bridgeRequest('/api/scans/latest');
    const indicator = document.querySelector('#reader-indicator');
    indicator.dataset.state = reader?.connected ? 'connected' : reader?.port ? 'issue' : 'offline';
    indicator.title = reader?.connected ? `NFC reader connected · ${reader.port}` : 'NFC reader unavailable. Click for details.';
    indicator.setAttribute('aria-label', indicator.title);
    document.querySelector('#reader-status').textContent = reader?.connected
      ? `NFC reader connected · ${reader.port}`
      : reader?.port ? `Reader unavailable · ${reader.port}` : 'Local NFC bridge · test mode';
    if (!window.cdLibraryAuth?.user) return;
    if (!scan) {
      renderScan(null);
      if (reader?.port && !reader.connected) {
        document.querySelector('#scan-description').textContent = 'Close Arduino Serial Monitor so the bridge can use the reader.';
      }
      return;
    }
    if (scan.id === state.lastScanId) return;
    const firstScan = state.lastScanId === 0;
    const userId = window.cdLibraryAuth.user.id;
    const { data: link, error } = await window.cdLibraryAuth.client
      .from('tag_links').select('cd_id').eq('uid', scan.uid).maybeSingle();
    if (error) throw error;
    if (window.cdLibraryAuth?.user?.id !== userId) return;
    let cd = link ? state.cds.find(item => item.id === link.cd_id) : null;
    if (link && !cd) {
      const { data: row, error: cdError } = await window.cdLibraryAuth.client
        .from('cds').select('payload').eq('id', link.cd_id).maybeSingle();
      if (cdError) throw cdError;
      cd = row?.payload || null;
    }
    if (window.cdLibraryAuth?.user?.id !== userId) return;
    state.lastScanId = scan.id;
    renderScan(scan, cd);
    const recent = Date.now() - Date.parse(scan.scannedAt) < 30_000;
    if (cd && (recent || !firstScan)) {
      if (!state.cds.some(item => item.id === cd.id)) state.cds.unshift(cd);
      state.selectedId = cd.id;
      state.query = '';
      document.querySelector('#collection-search').value = '';
      setView('stack');
      showScanToast(`Scanned ${cd.album}`);
    }
    if (!link && (recent || !firstScan) && !dialog.open) openAdd(scan.uid);
  } catch {
    document.querySelector('#reader-indicator').dataset.state = 'issue';
    document.querySelector('#scan-title').textContent = 'Could not check this scan';
    document.querySelector('#scan-description').textContent = 'Check the bridge and your account connection, then scan again.';
    document.querySelector('#scan-action').hidden = true;
  } finally {
    state.scanBusy = false;
  }
}

async function initBridge() {
  try {
    const { reader } = await bridgeRequest('/api/scans/latest');
    if (!reader) return;
    state.bridge = true;
    document.querySelector('#scan-panel').hidden = !window.cdLibraryAuth?.user;
    renderScan(null);
    await pollLatestScan();
    setInterval(pollLatestScan, 1500);
  } catch {
    // GitHub Pages has no USB bridge; the account library still works.
  }
}

function artistName(credit, fallback = '') {
  if (!Array.isArray(credit)) return fallback;
  return credit.map(part => typeof part === 'string' ? part : part.name || '').join('').trim() || fallback;
}

function editionLabel(release) {
  const parts = [release.date?.slice(0, 4), release.country, release.media?.map(m => m.format).filter(Boolean).join(' + ')];
  return parts.filter(Boolean).join(' · ') || 'CD edition';
}

function cover(container, releaseId, releaseGroupId, size = 250) {
  const request = (container.coverRequest || 0) + 1;
  container.coverRequest = request;
  container.replaceChildren();
  const fallback = document.createElement('div');
  fallback.className = 'album-cover';
  fallback.textContent = '◎';
  container.append(fallback);
  const ids = [releaseId && `/release/${releaseId}/front-${size}`, releaseGroupId && `/release-group/${releaseGroupId}/front-${size}`].filter(Boolean);
  const image = new Image();
  image.className = 'album-cover';
  image.alt = '';
  image.draggable = false;
  let index = 0;
  image.onload = () => { if (container.coverRequest === request) container.replaceChildren(image); };
  image.onerror = () => {
    index++;
    if (index < ids.length) image.src = COVER_ART + ids[index];
  };
  if (ids.length) image.src = COVER_ART + ids[0];
}

const STACK_PAGE_SIZE = 12;
function renderLibrary() {
  updateStackMotion();
  state.filtered = LibraryUI.filter(state.cds, state.query);
  if (!state.filtered.some(cd => cd.id === state.selectedId) && state.filtered.length) state.selectedId = state.filtered[0].id;
  state.activeIndex = Math.max(0, state.cds.findIndex(cd => cd.id === state.selectedId));
  const filteredIndex = state.filtered.findIndex(cd => cd.id === state.selectedId);
  state.stackPage = Math.max(0, Math.floor(filteredIndex / STACK_PAGE_SIZE));
  document.querySelector('#cd-count').textContent = state.query
    ? `${state.filtered.length} of ${state.cds.length} CDs`
    : `${state.cds.length} ${state.cds.length === 1 ? 'CD' : 'CDs'}`;
  document.querySelectorAll('[data-view]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.view === state.view)));
  document.querySelector('#footer-view').value = state.view;
  const empty = document.querySelector('#empty-state');
  empty.hidden = state.filtered.length > 0;
  document.querySelector('#empty-title').textContent = state.cds.length ? 'No matching albums.' : 'Your collection starts here.';
  document.querySelector('#empty-description').textContent = state.cds.length ? 'Try another album or artist in the search above.' : 'Add your first CD, or scan a new NFC tag to link an album.';
  grid.hidden = !state.filtered.length || state.view === 'stack';
  stackView.hidden = !state.filtered.length || state.view !== 'stack';
  document.querySelector('#stack-controls').hidden = stackView.hidden;
  document.body.classList.toggle('stack-active', !stackView.hidden);
  window.CDStack3D?.setVisible(!stackView.hidden);
  grid.replaceChildren();
  if (state.view === 'stack') { renderStack(); return; }
  const grouped = ['artists', 'genres', 'years'].includes(state.view);
  grid.classList.toggle('is-grouped', grouped);
  if (grouped) {
    for (const [title, cds] of LibraryUI.groups(state.filtered, state.view)) {
      const section = document.createElement('section');
      section.className = 'collection-group';
      const heading = document.createElement('h2');
      heading.textContent = `${title} · ${cds.length}`;
      const albums = document.createElement('div');
      albums.className = 'group-albums';
      cds.forEach(cd => albums.append(albumCard(cd)));
      section.append(heading, albums);
      grid.append(section);
    }
  } else state.filtered.forEach(cd => grid.append(albumCard(cd)));
}

function albumCard(cd) {
  const card = document.createElement('button');
  card.className = 'album-card';
  card.type = 'button';
  card.setAttribute('aria-label', `Select ${cd.album} by ${cd.artist}`);
  card.setAttribute('aria-pressed', String(cd.id === state.selectedId));
  const art = document.createElement('div');
  cover(art, cd.id, cd.releaseGroupId);
  const name = document.createElement('strong');
  name.textContent = cd.album;
  const artist = document.createElement('small');
  artist.textContent = cd.artist;
  card.append(art, name, artist);
  card.addEventListener('click', () => {
    state.selectedId = cd.id;
    setView('stack');
  });
  return card;
}

function selectStack(index, focusCase = false) {
  const cd = state.cds[index];
  if (!cd) return;
  if (state.selectedId !== cd.id) document.querySelector('#favorite-status').textContent = '';
  state.selectedId = cd.id;
  state.activeIndex = index;
  const filteredIndex = state.filtered.findIndex(item => item.id === cd.id);
  const page = Math.max(0, Math.floor(filteredIndex / STACK_PAGE_SIZE));
  if (page !== state.stackPage) { state.stackPage = page; renderStack(); }
  const localIndex = state.stackCds.findIndex(item => item.id === cd.id);
  window.CDStack3D?.select(localIndex);
  for (const button of stack.querySelectorAll('.stack-case')) button.setAttribute('aria-pressed', String(button.dataset.id === cd.id));
  const preview = document.querySelector('#stack-preview-cover');
  if (preview.dataset.album !== cd.id) {
    preview.dataset.album = cd.id;
    cover(preview, cd.id, cd.releaseGroupId, 500);
  }
  document.querySelector('#stack-position').textContent = `CD ${filteredIndex + 1} OF ${state.filtered.length}`;
  document.querySelector('#stack-album').textContent = cd.album;
  document.querySelector('#stack-artist').textContent = cd.artist;
  const metadata = [cd.date?.slice(0, 4), LibraryUI.genres(cd).slice(0, 2).join(', '), LibraryUI.label(cd)].filter(Boolean);
  if (metadata.length < 2) metadata.push(`${cd.tracks?.length || 0} tracks`);
  document.querySelector('#stack-edition').textContent = metadata.join('  •  ');
  const favorite = document.querySelector('#favorite-cd');
  favorite.setAttribute('aria-pressed', String(Boolean(cd.favorite)));
  favorite.setAttribute('aria-label', cd.favorite ? 'Remove from favorites' : 'Favorite album');
  favorite.disabled = state.favoriteBusy;
  document.querySelector('#stack-previous').disabled = state.filtered.length < 2;
  document.querySelector('#stack-next').disabled = state.filtered.length < 2;
  const start = state.stackPage * STACK_PAGE_SIZE;
  document.querySelector('#stack-range').textContent = state.filtered.length > STACK_PAGE_SIZE
    ? `${start + 1}–${Math.min(start + STACK_PAGE_SIZE, state.filtered.length)} of ${state.filtered.length}`
    : `${Math.max(0, filteredIndex) + 1} / ${state.filtered.length}`;
  document.querySelector('#album-more').open = false;
  if (focusCase) stack.querySelector(`[data-index="${localIndex}"]`)?.focus({ preventScroll: true });
}

function renderStack() {
  stack.replaceChildren();
  const start = state.stackPage * STACK_PAGE_SIZE;
  state.stackCds = state.filtered.slice(start, start + STACK_PAGE_SIZE);
  const offsets = [0, -9, 6, -5, 11, -7, 3, -2];
  for (const [localIndex, cd] of state.stackCds.entries()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'stack-case';
    button.dataset.index = String(localIndex);
    button.dataset.id = cd.id;
    button.style.setProperty('--case-offset', `${offsets[localIndex % offsets.length]}px`);
    button.setAttribute('aria-label', `Select ${cd.album} by ${cd.artist}`);
    button.title = `${cd.artist} — ${cd.album}`;
    const copy = document.createElement('span');
    copy.className = 'stack-spine-copy';
    const album = document.createElement('strong');
    album.textContent = cd.album;
    const artist = document.createElement('small');
    artist.textContent = cd.artist;
    copy.append(album, artist);
    button.append(copy);
    button.addEventListener('pointerenter', event => { if (event.pointerType !== 'touch') window.CDStack3D?.hover(localIndex); });
    button.addEventListener('pointerleave', () => window.CDStack3D?.hover(-1));
    button.addEventListener('focus', () => window.CDStack3D?.hover(localIndex));
    button.addEventListener('blur', () => window.CDStack3D?.hover(-1));
    button.addEventListener('click', () => selectStack(state.cds.findIndex(item => item.id === cd.id)));
    stack.append(button);
  }
  window.CDStack3D?.setAlbums(state.stackCds);
  if (state.stackCds.length) selectStack(state.activeIndex);
}

function moveStack(step) {
  if (!state.filtered.length) return;
  const index = state.filtered.findIndex(cd => cd.id === state.selectedId);
  const next = state.filtered[(index + step + state.filtered.length) % state.filtered.length];
  selectStack(state.cds.findIndex(cd => cd.id === next.id), true);
}

async function toggleFavorite() {
  const cd = state.cds.find(item => item.id === state.selectedId);
  const userId = window.cdLibraryAuth?.user?.id;
  if (!cd || !userId || state.favoriteBusy) return;
  state.favoriteBusy = true;
  const button = document.querySelector('#favorite-cd');
  button.disabled = true;
  const message = document.querySelector('#favorite-status');
  message.textContent = '';
  const updated = { ...cd, favorite: !cd.favorite };
  try {
    const { data, error } = await window.cdLibraryAuth.client.from('cds').update({ payload: updated }).eq('id', cd.id).select('id').maybeSingle();
    if (error || !data) throw error || new Error('Your account could not update this album.');
    if (window.cdLibraryAuth?.user?.id !== userId) return;
    state.cds = state.cds.map(item => item.id === cd.id ? updated : item);
    selectStack(state.activeIndex);
    message.textContent = updated.favorite ? 'Added to favorites.' : 'Removed from favorites.';
  } catch (error) { message.textContent = `Could not save favorite: ${error.message}`; }
  finally { state.favoriteBusy = false; button.disabled = false; }
}

function setStatus(message, isError = false) {
  status.textContent = message;
  status.classList.toggle('error', isError);
}

function showSearch() {
  document.querySelector('#dialog-title').textContent = 'Add a CD';
  document.querySelector('#search-stage').hidden = false;
  document.querySelector('#detail-stage').hidden = true;
}

function openAdd(uid = null) {
  state.pendingUid = uid;
  const enrollment = document.querySelector('#tag-enrollment');
  enrollment.hidden = !uid;
  enrollment.textContent = uid ? `Adding a CD for scanned tag ${uid}` : '';
  searchForm.reset();
  results.replaceChildren();
  setStatus('');
  showSearch();
  dialog.showModal();
  document.querySelector('#album-name').focus();
}

function escapeLucene(value) {
  return value.replace(/[+&|!(){}\[\]^"~*?:\\/\-]/g, '\\$&');
}

async function fetchMusicBrainz(path, onRetry) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const elapsed = Date.now() - state.lastRequestAt;
    if (elapsed < 1200) await new Promise(resolve => setTimeout(resolve, 1200 - elapsed));
    state.lastRequestAt = Date.now();
    const response = await fetch(MUSICBRAINZ + path, { headers: { Accept: 'application/json' } });
    if (response.ok) return response.json();
    if (response.status !== 503 && response.status !== 429) {
      throw new Error('MusicBrainz could not load this album.');
    }
    if (attempt === 2) throw new Error('MusicBrainz is still busy. Please try again in a moment.');
    onRetry?.();
    await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
  }
}

async function musicBrainzGet(path, onRetry) {
  if (requestCache.has(path)) return requestCache.get(path);
  const pending = requestQueue.then(() => fetchMusicBrainz(path, onRetry));
  requestQueue = pending.catch(() => {});
  requestCache.set(path, pending);
  try {
    return await pending;
  } catch (error) {
    requestCache.delete(path);
    throw error;
  }
}

function renderResults(releases, inputArtist) {
  results.replaceChildren();
  if (!releases.length) {
    setStatus('No CD editions found. Try a shorter album or artist name.');
    return;
  }
  setStatus(`Choose the edition that matches your CD (${releases.length} results).`);
  for (const release of releases) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'result-button';
    const art = document.createElement('div');
    art.className = 'result-cover';
    cover(art, release.id, release['release-group']?.id);
    const copy = document.createElement('div');
    copy.className = 'result-copy';
    const title = document.createElement('strong');
    title.textContent = `${release.title} — ${artistName(release['artist-credit'], inputArtist)}`;
    const info = document.createElement('small');
    const details = editionLabel(release);
    info.textContent = `${details}${release['track-count'] ? ` · ${release['track-count']} tracks` : ''}`;
    copy.append(title, info);
    const catalogNumber = release['label-info']?.map(label => label['catalog-number']).find(Boolean);
    if (catalogNumber || release.barcode) {
      const identifiers = document.createElement('small');
      identifiers.textContent = [catalogNumber && `Catalog ${catalogNumber}`, release.barcode && `Barcode ${release.barcode}`].filter(Boolean).join(' · ');
      copy.append(identifiers);
    }
    button.append(art, copy);
    button.addEventListener('click', () => selectRelease(release, inputArtist));
    results.append(button);
  }
}

async function selectRelease(release, inputArtist) {
  const buttons = results.querySelectorAll('button');
  buttons.forEach(button => button.disabled = true);
  setStatus('Loading track list…');
  try {
    const detail = await musicBrainzGet(`/release/${encodeURIComponent(release.id)}?inc=recordings+release-groups+artist-credits+labels+genres&fmt=json`, () => {
      setStatus('MusicBrainz is busy. Retrying automatically…');
    });
    const tracks = (detail.media || [])
      .filter(medium => (medium.format || '').toLowerCase().includes('cd'))
      .flatMap(medium => (medium.tracks || []).map(track => ({
        disc: medium.position || 1,
        number: track.number || String(track.position),
        title: track.title || track.recording?.title || 'Untitled track',
        length: track.length ?? track.recording?.length ?? null
      })));
    if (!tracks.length) throw new Error('This edition has no CD track list. Please choose another result.');
    const cd = {
      id: detail.id,
      releaseGroupId: detail['release-group']?.id || release['release-group']?.id || null,
      album: detail.title,
      artist: artistName(detail['artist-credit'], inputArtist),
      date: detail.date || '',
      country: detail.country || '',
      genres: (detail.genres || []).map(genre => genre.name).filter(Boolean),
      label: (detail['label-info'] || []).map(info => info.label?.name).find(Boolean) || '',
      media: detail.media.map(m => m.format).filter(Boolean),
      tracks
    };
    showDetails(cd, 'new');
    setStatus('');
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    buttons.forEach(button => button.disabled = false);
  }
}

function duration(milliseconds) {
  if (!Number.isFinite(milliseconds)) return '';
  const seconds = Math.round(milliseconds / 1000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

function showDetails(cd, mode) {
  state.selected = cd;
  state.mode = mode;
  if (!dialog.open) dialog.showModal();
  document.querySelector('#dialog-title').textContent = mode === 'saved' ? 'CD details' : 'Review this CD';
  document.querySelector('#search-stage').hidden = true;
  document.querySelector('#detail-stage').hidden = false;
  document.querySelector('#back-to-results').hidden = mode === 'saved';
  document.querySelector('#save-cd').hidden = mode === 'saved';
  document.querySelector('#remove-cd').hidden = mode !== 'saved';
  document.querySelector('#detail-album').textContent = cd.album;
  document.querySelector('#detail-artist').textContent = cd.artist;
  document.querySelector('#detail-edition').textContent = [cd.date?.slice(0, 4), cd.country, cd.media?.join(' + ')].filter(Boolean).join(' · ');
  cover(document.querySelector('#detail-cover'), cd.id, cd.releaseGroupId);
  const list = document.querySelector('#track-list');
  list.replaceChildren();
  const multipleDiscs = new Set(cd.tracks.map(track => track.disc)).size > 1;
  for (const track of cd.tracks) {
    const item = document.createElement('li');
    item.textContent = `${multipleDiscs ? `Disc ${track.disc} · ` : ''}${track.title}`;
    const time = duration(track.length);
    if (time) {
      const small = document.createElement('small');
      small.textContent = time;
      item.append(small);
    }
    list.append(item);
  }
  const alreadySaved = state.cds.some(item => item.id === cd.id);
  document.querySelector('#save-cd').textContent = alreadySaved
    ? (state.pendingUid ? 'Link this CD to tag' : 'Already in library')
    : (state.pendingUid ? 'Save and link to tag' : 'Save to library');
  document.querySelector('#save-cd').disabled = alreadySaved && !state.pendingUid;
}

document.querySelector('#add-cd').addEventListener('click', () => openAdd());
function connectStackRenderer() {
  const viewer = window.CDStack3D;
  if (!viewer) return;
  viewer.onSelect = index => {
    const cd = state.stackCds[index];
    if (cd) selectStack(state.cds.findIndex(item => item.id === cd.id));
  };
  viewer.setMotion(state.animateStack);
  viewer.setVisible(!stackView.hidden);
  if (state.view === 'stack') renderStack();
}
window.addEventListener('cd-stack-3d-ready', connectStackRenderer);
window.addEventListener('cd-library-auth-change', onAuthChange);
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => setView(button.dataset.view)));
document.querySelector('#footer-view').addEventListener('change', event => setView(event.target.value));
document.querySelector('#collection-search').addEventListener('input', event => { state.query = event.target.value; renderLibrary(); });
document.querySelector('#favorite-cd').addEventListener('click', toggleFavorite);
document.querySelector('#more-details').addEventListener('click', () => {
  document.querySelector('#album-more').open = false;
  if (state.cds[state.activeIndex]) showDetails(state.cds[state.activeIndex], 'saved');
});
document.querySelector('#more-remove').addEventListener('click', () => {
  document.querySelector('#album-more').open = false;
  if (state.cds[state.activeIndex]) {
    showDetails(state.cds[state.activeIndex], 'saved');
    document.querySelector('#remove-cd').focus();
  }
});
document.querySelector('#reader-indicator').addEventListener('click', () => {
  const panel = document.querySelector('#scan-panel');
  panel.hidden = false;
  const open = panel.classList.toggle('is-open');
  document.querySelector('#reader-indicator').setAttribute('aria-expanded', String(open));
});
document.querySelector('#stack-motion').addEventListener('click', () => {
  state.animateStack = !state.animateStack;
  try {
    localStorage.setItem(MOTION_KEY, state.animateStack ? 'on' : 'off');
  } catch {
    // Animation still works when storage is unavailable.
  }
  updateStackMotion();
});
document.querySelector('#stack-previous').addEventListener('click', () => moveStack(-1));
document.querySelector('#stack-next').addEventListener('click', () => moveStack(1));
document.querySelector('#stack-open').addEventListener('click', () => {
  if (state.cds[state.activeIndex]) showDetails(state.cds[state.activeIndex], 'saved');
});
stack.addEventListener('keydown', event => {
  if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
    event.preventDefault();
    moveStack(event.key === 'ArrowUp' ? -1 : 1);
  }
});
document.querySelector('#close-dialog').addEventListener('click', () => dialog.close());
dialog.addEventListener('close', () => { state.pendingUid = null; });
document.querySelector('#back-to-results').addEventListener('click', showSearch);
searchForm.addEventListener('submit', async event => {
  event.preventDefault();
  const album = document.querySelector('#album-name').value.trim();
  const artist = document.querySelector('#artist-name').value.trim();
  if (!album || !artist) return;
  const button = document.querySelector('#search-button');
  button.disabled = true;
  results.replaceChildren();
  setStatus('Searching MusicBrainz…');
  try {
    const query = `release:"${escapeLucene(album)}" AND artist:"${escapeLucene(artist)}" AND format:CD`;
    const data = await musicBrainzGet(`/release/?query=${encodeURIComponent(query)}&fmt=json&limit=10`, () => {
      setStatus('MusicBrainz is busy. Retrying automatically…');
    });
    renderResults(data.releases || [], artist);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    button.disabled = false;
  }
});
document.querySelector('#save-cd').addEventListener('click', async event => {
  const cd = state.selected;
  const alreadySaved = state.cds.some(item => item.id === cd?.id);
  if (!cd || (alreadySaved && !state.pendingUid)) return;
  const button = event.currentTarget;
  button.disabled = true;
  const userId = window.cdLibraryAuth?.user?.id;
  const uid = state.pendingUid;
  try {
    if (!userId) throw new Error('Sign in to save this CD to your account.');
    if (!alreadySaved) {
      const { error } = await window.cdLibraryAuth.client.from('cds').insert({ id: cd.id, payload: cd });
      if (error) throw error;
    }
    if (uid) {
      const { error } = await window.cdLibraryAuth.client.from('tag_links').insert({ uid, cd_id: cd.id });
      if (error) {
        if (!alreadySaved) await window.cdLibraryAuth.client.from('cds').delete().eq('id', cd.id);
        throw error;
      }
    }
  } catch (error) {
    alert(error.message);
    button.disabled = false;
    return;
  }
  if (window.cdLibraryAuth?.user?.id === userId && !alreadySaved) state.cds.unshift(cd);
  if (uid && state.bridge) {
    try {
      await bridgeRequest('/api/enroll', { method: 'POST', body: JSON.stringify({ cd, uid, replace: true }) });
    } catch (error) {
      setLibraryStatus(`Saved to your account, but the ESP32 display cache could not update: ${error.message}`, true);
    }
  }
  if (uid && state.currentScan?.uid === uid) renderScan(state.currentScan, cd);
  state.pendingUid = null;
  state.selectedId = cd.id;
  state.query = '';
  document.querySelector('#collection-search').value = '';
  setView('stack');
  dialog.close();
});
document.querySelector('#remove-cd').addEventListener('click', async () => {
  const cd = state.selected;
  if (!cd || !confirm(`Remove ${cd.album} from your library?`)) return;
  const userId = window.cdLibraryAuth?.user?.id;
  try {
    if (!userId) throw new Error('Sign in to remove this CD from your account.');
    const { error } = await window.cdLibraryAuth.client.from('cds').delete().eq('id', cd.id);
    if (error) throw error;
  } catch (error) {
    alert(error.message);
    return;
  }
  if (window.cdLibraryAuth?.user?.id === userId) state.cds = state.cds.filter(item => item.id !== cd.id);
  if (state.bridge) {
    try {
      await bridgeRequest(`/api/cds/${encodeURIComponent(cd.id)}`, { method: 'DELETE' });
    } catch (error) {
      setLibraryStatus(`Removed from your account, but the ESP32 display cache could not update: ${error.message}`, true);
    }
  }
  renderLibrary();
  dialog.close();
  if (state.currentScan) {
    state.lastScanId = 0;
    void pollLatestScan();
  }
});
connectStackRenderer();
renderLibrary();
onAuthChange();
void initBridge();
