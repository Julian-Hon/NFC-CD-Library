const STORAGE_KEY = 'digital-cd-library:cds:v1';
const MUSICBRAINZ = 'https://musicbrainz.org/ws/2';
const COVER_ART = 'https://coverartarchive.org';

const dialog = document.querySelector('#cd-dialog');
const searchForm = document.querySelector('#search-form');
const status = document.querySelector('#search-status');
const results = document.querySelector('#search-results');
const grid = document.querySelector('#album-grid');
const stackView = document.querySelector('#stack-view');
const stack = document.querySelector('#cd-stack');
const state = { cds: loadCds(), selected: null, mode: 'new', view: 'grid', activeIndex: 0, lastRequestAt: 0 };
const requestCache = new Map();
let requestQueue = Promise.resolve();

function loadCds() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function saveCds() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.cds));
    return true;
  } catch {
    alert('Could not save this CD in your browser. Check that browser storage is enabled.');
    return false;
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

function cover(container, releaseId, releaseGroupId) {
  container.replaceChildren();
  const fallback = document.createElement('div');
  fallback.className = 'album-cover';
  fallback.textContent = '◎';
  container.append(fallback);
  const ids = [releaseId && `/release/${releaseId}/front-250`, releaseGroupId && `/release-group/${releaseGroupId}/front-250`].filter(Boolean);
  const image = new Image();
  image.className = 'album-cover';
  image.alt = '';
  let index = 0;
  image.onload = () => container.replaceChildren(image);
  image.onerror = () => {
    index++;
    if (index < ids.length) image.src = COVER_ART + ids[index];
  };
  if (ids.length) image.src = COVER_ART + ids[0];
}

function renderLibrary() {
  document.querySelector('#cd-count').textContent = `${state.cds.length} ${state.cds.length === 1 ? 'CD' : 'CDs'}`;
  document.querySelector('#empty-state').hidden = state.cds.length > 0;
  grid.hidden = state.cds.length === 0 || state.view !== 'grid';
  stackView.hidden = state.cds.length === 0 || state.view !== 'stack';
  document.querySelector('#grid-view').setAttribute('aria-pressed', state.view === 'grid');
  document.querySelector('#stack-view-button').setAttribute('aria-pressed', state.view === 'stack');
  grid.replaceChildren();
  if (state.view === 'stack') {
    renderStack();
    return;
  }
  for (const cd of state.cds) {
    const card = document.createElement('button');
    card.className = 'album-card';
    card.type = 'button';
    card.setAttribute('aria-label', `View ${cd.album} by ${cd.artist}`);
    const art = document.createElement('div');
    cover(art, cd.id, cd.releaseGroupId);
    const name = document.createElement('strong');
    name.textContent = cd.album;
    const artist = document.createElement('small');
    artist.textContent = cd.artist;
    card.append(art, name, artist);
    card.addEventListener('click', () => showDetails(cd, 'saved'));
    grid.append(card);
  }
}

function renderStack() {
  if (!state.cds.length) {
    stack.replaceChildren();
    return;
  }
  state.activeIndex = Math.min(state.activeIndex, state.cds.length - 1);
  const active = state.cds[state.activeIndex];
  const first = Math.max(0, state.activeIndex - 3);
  const last = Math.min(state.cds.length - 1, state.activeIndex + 3);
  const visibleIds = new Set(state.cds.slice(first, last + 1).map(cd => cd.id));
  for (const caseButton of [...stack.children]) {
    if (!visibleIds.has(caseButton.dataset.id)) caseButton.remove();
  }
  const existing = new Map([...stack.children].map(caseButton => [caseButton.dataset.id, caseButton]));
  for (let index = first; index <= last; index++) {
    const cd = state.cds[index];
    const offset = index - state.activeIndex;
    let caseButton = existing.get(cd.id);
    if (!caseButton) {
      caseButton = document.createElement('button');
      caseButton.type = 'button';
      caseButton.className = 'stack-case';
      caseButton.dataset.id = cd.id;
      const art = document.createElement('div');
      art.className = 'stack-art';
      cover(art, cd.id, cd.releaseGroupId);
      caseButton.append(art);
      stack.append(caseButton);
    }
    caseButton.setAttribute('aria-label', `${offset === 0 ? 'Open' : 'Select'} ${cd.album} by ${cd.artist}`);
    caseButton.setAttribute('aria-current', offset === 0 ? 'true' : 'false');
    caseButton.style.setProperty('--offset', offset);
    caseButton.style.setProperty('--distance', Math.abs(offset));
    caseButton.style.zIndex = String(10 - Math.abs(offset));
    caseButton.onclick = () => {
      if (index === state.activeIndex) showDetails(cd, 'saved');
      else {
        state.activeIndex = index;
        renderStack();
        stack.querySelector('[aria-current="true"]')?.focus({ preventScroll: true });
      }
    };
  }
  document.querySelector('#stack-position').textContent = `${state.activeIndex + 1} / ${state.cds.length}`;
  document.querySelector('#stack-album').textContent = active.album;
  document.querySelector('#stack-artist').textContent = active.artist;
  document.querySelector('#stack-previous').disabled = state.activeIndex === 0;
  document.querySelector('#stack-next').disabled = state.activeIndex === state.cds.length - 1;
}

function moveStack(step) {
  const next = state.activeIndex + step;
  if (next < 0 || next >= state.cds.length) return;
  const caseHadFocus = stack.contains(document.activeElement);
  state.activeIndex = next;
  renderStack();
  if (caseHadFocus) stack.querySelector('[aria-current="true"]')?.focus({ preventScroll: true });
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

function openAdd() {
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
    const detail = await musicBrainzGet(`/release/${encodeURIComponent(release.id)}?inc=recordings+release-groups&fmt=json`, () => {
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
  document.querySelector('#save-cd').textContent = alreadySaved ? 'Already in library' : 'Save to library';
  document.querySelector('#save-cd').disabled = alreadySaved;
}

document.querySelector('#add-cd').addEventListener('click', openAdd);
document.querySelector('#grid-view').addEventListener('click', () => {
  state.view = 'grid';
  renderLibrary();
});
document.querySelector('#stack-view-button').addEventListener('click', () => {
  state.view = 'stack';
  renderLibrary();
});
document.querySelector('#stack-previous').addEventListener('click', () => moveStack(-1));
document.querySelector('#stack-next').addEventListener('click', () => moveStack(1));
document.querySelector('#stack-open').addEventListener('click', () => showDetails(state.cds[state.activeIndex], 'saved'));
stackView.addEventListener('keydown', event => {
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
    event.preventDefault();
    moveStack(event.key === 'ArrowLeft' ? -1 : 1);
  }
});
document.querySelector('#close-dialog').addEventListener('click', () => dialog.close());
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
document.querySelector('#save-cd').addEventListener('click', () => {
  const cd = state.selected;
  if (!cd || state.cds.some(item => item.id === cd.id)) return;
  state.cds.unshift(cd);
  if (!saveCds()) {
    state.cds.shift();
    return;
  }
  state.activeIndex = 0;
  renderLibrary();
  dialog.close();
});
document.querySelector('#remove-cd').addEventListener('click', () => {
  const cd = state.selected;
  if (!cd || !confirm(`Remove ${cd.album} from your library?`)) return;
  const original = state.cds;
  state.cds = state.cds.filter(item => item.id !== cd.id);
  if (!saveCds()) {
    state.cds = original;
    return;
  }
  renderLibrary();
  dialog.close();
});
renderLibrary();
