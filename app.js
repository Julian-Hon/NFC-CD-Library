const STORAGE_KEY = 'digital-cd-library:cds:v1';
const VIEW_KEY = 'digital-cd-library:view:v1';
const MUSICBRAINZ = 'https://musicbrainz.org/ws/2';
const COVER_ART = 'https://coverartarchive.org';

const dialog = document.querySelector('#cd-dialog');
const searchForm = document.querySelector('#search-form');
const status = document.querySelector('#search-status');
const results = document.querySelector('#search-results');
const grid = document.querySelector('#album-grid');
const stackView = document.querySelector('#stack-view');
const stack = document.querySelector('#cd-stack');
const stackPeek = document.querySelector('#stack-peek');
const state = { cds: loadCds(), selected: null, mode: 'new', view: loadView(), activeIndex: 0, lastRequestAt: 0, transitioning: false };
const requestCache = new Map();
let requestQueue = Promise.resolve();
let stackDrag = null;
let suppressStackClick = false;

function loadCds() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(value) ? value : [];
  } catch {
    return [];
  }
}

function loadView() {
  try {
    return localStorage.getItem(VIEW_KEY) === 'stack' ? 'stack' : 'grid';
  } catch {
    return 'grid';
  }
}

function setView(view) {
  state.view = view;
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Browsing still works when storage is unavailable.
  }
  renderLibrary();
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
  image.draggable = false;
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
  const emptyState = document.querySelector('#empty-state');
  emptyState.hidden = state.cds.length > 0;
  emptyState.classList.toggle('is-stack', state.view === 'stack');
  document.querySelector('#empty-title').textContent = state.view === 'stack' ? 'Your stack is empty.' : 'No CDs yet.';
  document.querySelector('#empty-description').textContent = state.view === 'stack'
    ? 'Add a CD to see its cover become the first case in your stack.'
    : 'Add an album to start your library, then explore it in Grid or Stack view.';
  grid.hidden = state.cds.length === 0 || state.view !== 'grid';
  stackView.hidden = state.cds.length === 0 || state.view !== 'stack';
  document.querySelector('#grid-view').setAttribute('aria-pressed', state.view === 'grid');
  document.querySelector('#stack-view-button').setAttribute('aria-pressed', state.view === 'stack');
  grid.replaceChildren();
  if (state.view === 'stack') {
    renderStack();
    return;
  }
  hideStackPeek();
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

function showStackPeek(cd, caseButton) {
  if (state.transitioning) return;
  const position = state.cds.findIndex(item => item.id === cd.id) + 1;
  document.querySelector('#stack-peek-position').textContent = `CD ${position} of ${state.cds.length}`;
  document.querySelector('#stack-peek-album').textContent = cd.album;
  document.querySelector('#stack-peek-artist').textContent = cd.artist;
  document.querySelector('#stack-peek-action').textContent = caseButton.dataset.depth === '0'
    ? 'Drag to browse · Click for details'
    : 'Click to bring forward';
  stackPeek.hidden = false;
}

function hideStackPeek() {
  stackPeek.hidden = true;
}

function renderStack(preserveCase = null) {
  hideStackPeek();
  if (!state.cds.length) {
    stack.querySelectorAll('.stack-case').forEach(caseButton => caseButton.remove());
    return;
  }
  state.activeIndex = Math.min(state.activeIndex, state.cds.length - 1);
  const active = state.cds[state.activeIndex];
  const visibleCount = Math.min(state.cds.length, 5);
  const visible = Array.from({ length: visibleCount }, (_, depth) => ({
    cd: state.cds[(state.activeIndex + depth) % state.cds.length], depth
  }));
  const visibleIds = new Set(visible.map(({ cd }) => cd.id));
  for (const caseButton of stack.querySelectorAll('.stack-case')) {
    if (!visibleIds.has(caseButton.dataset.id) && caseButton !== preserveCase) caseButton.remove();
  }
  const existing = new Map([...stack.querySelectorAll('.stack-case')].map(caseButton => [caseButton.dataset.id, caseButton]));
  for (const { cd, depth } of visible) {
    let caseButton = existing.get(cd.id);
    if (!caseButton) {
      caseButton = document.createElement('button');
      caseButton.type = 'button';
      caseButton.className = 'stack-case';
      caseButton.dataset.id = cd.id;
      const art = document.createElement('div');
      art.className = 'stack-art';
      cover(art, cd.id, cd.releaseGroupId);
      const hinge = document.createElement('span');
      hinge.className = 'stack-hinge';
      hinge.setAttribute('aria-hidden', 'true');
      caseButton.append(art, hinge);
      caseButton.addEventListener('mouseenter', () => showStackPeek(cd, caseButton));
      caseButton.addEventListener('mouseleave', () => {
        if (document.activeElement !== caseButton) hideStackPeek();
      });
      caseButton.addEventListener('focus', () => showStackPeek(cd, caseButton));
      caseButton.addEventListener('blur', hideStackPeek);
      stack.append(caseButton);
    }
    caseButton.setAttribute('aria-label', `${depth === 0 ? 'Open' : 'Select'} ${cd.album} by ${cd.artist}`);
    caseButton.setAttribute('aria-current', depth === 0 ? 'true' : 'false');
    caseButton.dataset.depth = String(depth);
    caseButton.classList.toggle('is-single', state.cds.length === 1);
    caseButton.style.zIndex = String(10 - depth);
    caseButton.onclick = () => {
      if (suppressStackClick || state.transitioning) return;
      if (depth === 0) showDetails(cd, 'saved');
      else {
        const nextIndex = state.cds.findIndex(item => item.id === cd.id);
        const forward = (nextIndex - state.activeIndex + state.cds.length) % state.cds.length;
        void transitionStackTo(nextIndex, forward <= state.cds.length / 2 ? 1 : -1);
      }
    };
  }
  document.querySelector('#stack-position').textContent = `${state.activeIndex + 1} / ${state.cds.length}`;
  document.querySelector('#stack-album').textContent = active.album;
  document.querySelector('#stack-artist').textContent = active.artist;
  document.querySelector('#stack-previous').disabled = state.cds.length < 2;
  document.querySelector('#stack-next').disabled = state.cds.length < 2;
}

async function transitionStackTo(nextIndex, direction) {
  if (state.transitioning || nextIndex === state.activeIndex || state.cds.length < 2) return;
  const oldTop = stack.querySelector('.stack-case[aria-current="true"]');
  const caseHadFocus = stack.contains(document.activeElement);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  state.transitioning = true;
  stackView.classList.add('is-traveling');
  stackView.setAttribute('aria-busy', 'true');
  hideStackPeek();
  try {
    if (!reducedMotion && oldTop) {
      const stageRect = stack.getBoundingClientRect();
      const caseRect = oldTop.getBoundingClientRect();
      const currentTranslate = getComputedStyle(oldTop).translate;
      const startX = currentTranslate === 'none' ? 0 : parseFloat(currentTranslate) || 0;
      const exitDistance = direction > 0
        ? stageRect.right - caseRect.left + 32
        : stageRect.left - caseRect.right - 32;
      const exit = oldTop.animate([
        { translate: currentTranslate === 'none' ? '0px 0px' : currentTranslate },
        { translate: `${startX + exitDistance}px -36px` }
      ], { duration: 950, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' });
      await exit.finished;
      oldTop.classList.remove('is-dragging');
      oldTop.style.removeProperty('--drag-x');
      oldTop.blur();
      state.activeIndex = nextIndex;
      renderStack(oldTop);
      const stillVisible = [...stack.querySelectorAll('.stack-case')]
        .filter(caseButton => caseButton !== oldTop)
        .length < Math.min(state.cds.length, 5);
      if (!stillVisible) {
        oldTop.dataset.depth = '4';
        oldTop.style.zIndex = '1';
        oldTop.setAttribute('aria-current', 'false');
        oldTop.setAttribute('aria-hidden', 'true');
        oldTop.tabIndex = -1;
      }
      oldTop.classList.add('is-repositioning');
      exit.cancel();
      const returnRect = oldTop.getBoundingClientRect();
      const returnDistance = direction > 0
        ? stageRect.right - returnRect.left + 32
        : stageRect.left - returnRect.right - 32;
      const returning = oldTop.animate([
        { translate: `${returnDistance}px -36px` },
        { translate: '0px 0px' }
      ], { duration: 1000, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'both' });
      await returning.finished;
      returning.cancel();
      oldTop.classList.remove('is-repositioning');
      if (!stillVisible) oldTop.remove();
    } else {
      oldTop?.classList.remove('is-dragging');
      oldTop?.style.removeProperty('--drag-x');
      state.activeIndex = nextIndex;
      renderStack();
    }
  } finally {
    state.transitioning = false;
    stackView.classList.remove('is-traveling');
    stackView.removeAttribute('aria-busy');
    if (caseHadFocus) stack.querySelector('.stack-case[aria-current="true"]')?.focus({ preventScroll: true });
  }
}

function moveStack(step) {
  if (state.cds.length < 2 || state.transitioning) return;
  const nextIndex = (state.activeIndex + step + state.cds.length) % state.cds.length;
  void transitionStackTo(nextIndex, step);
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
document.querySelector('#grid-view').addEventListener('click', () => setView('grid'));
document.querySelector('#stack-view-button').addEventListener('click', () => setView('stack'));
document.querySelector('#stack-previous').addEventListener('click', () => moveStack(-1));
document.querySelector('#stack-next').addEventListener('click', () => moveStack(1));
document.querySelector('#stack-open').addEventListener('click', () => {
  if (!state.transitioning) showDetails(state.cds[state.activeIndex], 'saved');
});
stack.addEventListener('pointerdown', event => {
  const caseButton = event.target.closest('.stack-case[aria-current="true"]');
  if (!caseButton || state.cds.length < 2 || state.transitioning || event.button !== 0) return;
  event.preventDefault();
  stackDrag = { button: caseButton, pointerId: event.pointerId, startX: event.clientX };
  caseButton.setPointerCapture(event.pointerId);
  caseButton.classList.add('is-dragging');
});
stack.addEventListener('pointermove', event => {
  if (!stackDrag || event.pointerId !== stackDrag.pointerId) return;
  const distance = event.clientX - stackDrag.startX;
  stackDrag.button.style.setProperty('--drag-x', `${distance}px`);
});
function endStackDrag(event) {
  if (!stackDrag || event.pointerId !== stackDrag.pointerId) return;
  const { button, startX } = stackDrag;
  const distance = event.clientX - startX;
  stackDrag = null;
  if (event.type !== 'pointercancel' && Math.abs(distance) > 45) {
    suppressStackClick = true;
    moveStack(distance > 0 ? 1 : -1);
    setTimeout(() => { suppressStackClick = false; }, 0);
  } else {
    button.classList.remove('is-dragging');
    button.style.removeProperty('--drag-x');
  }
}
stack.addEventListener('pointerup', endStackDrag);
stack.addEventListener('pointercancel', endStackDrag);
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
