const STORAGE_KEY = 'digital-cd-library:cds:v1';
const MUSICBRAINZ = 'https://musicbrainz.org/ws/2';
const COVER_ART = 'https://coverartarchive.org';

const dialog = document.querySelector('#cd-dialog');
const searchForm = document.querySelector('#search-form');
const status = document.querySelector('#search-status');
const results = document.querySelector('#search-results');
const grid = document.querySelector('#album-grid');
const state = { cds: loadCds(), selected: null, mode: 'new', lastRequestAt: 0 };

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
  grid.replaceChildren();
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

async function musicBrainzGet(path) {
  const elapsed = Date.now() - state.lastRequestAt;
  if (elapsed < 1200) await new Promise(resolve => setTimeout(resolve, 1200 - elapsed));
  state.lastRequestAt = Date.now();
  const response = await fetch(MUSICBRAINZ + path, { headers: { Accept: 'application/json' } });
  if (!response.ok) throw new Error(response.status === 503 ? 'MusicBrainz is busy. Please wait a moment and try again.' : 'MusicBrainz could not load this album.');
  return response.json();
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
    const detail = await musicBrainzGet(`/release/${encodeURIComponent(release.id)}?inc=recordings+release-groups&fmt=json`);
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
    const data = await musicBrainzGet(`/release/?query=${encodeURIComponent(query)}&fmt=json&limit=10`);
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
