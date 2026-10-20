// Small view helpers shared by the header, collection and album preview.
(() => {
  const paths = {
    stack: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    artists: '<circle cx="12" cy="7" r="4"/><path d="M4 21v-3a8 8 0 0 1 16 0v3"/>',
    genres: '<path d="m4 20 3-8L18 1l5 5-11 11-8 3Z"/><path d="m7 12 5 5"/>',
    years: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M7 2v6m10-6v6M3 11h18"/>',
    search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
    plus: '<path d="M12 4v16M4 12h16"/>',
    heart: '<path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1.1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z"/>',
    more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
    tracks: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    chevron: '<path d="m7 10 5 5 5-5"/>',
    nfc: '<path d="M4 8a6 6 0 0 1 0 8M8 5a10 10 0 0 1 0 14m8-14a10 10 0 0 0 0 14m4-11a6 6 0 0 0 0 8"/>'
  };
  function icon(name) {
    const span = document.createElement('span');
    span.className = 'icon';
    span.setAttribute('aria-hidden', 'true');
    span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${paths[name] || paths.stack}</svg>`;
    return span;
  }
  const normalize = value => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const genres = cd => (Array.isArray(cd.genres) ? cd.genres : cd.genre ? [cd.genre] : []).map(g => typeof g === 'string' ? g : g.name).filter(Boolean);
  const label = cd => typeof cd.label === 'string' ? cd.label : cd.label?.name || '';
  const filter = (cds, query) => {
    const terms = normalize(query).trim().split(/\s+/).filter(Boolean);
    return cds.filter(cd => terms.every(term => normalize(`${cd.album} ${cd.artist}`).includes(term)));
  };
  function groups(cds, view) {
    const map = new Map();
    for (const cd of cds) {
      const keys = view === 'artists' ? [cd.artist || 'Unknown artist'] : view === 'years' ? [cd.date?.slice(0, 4) || 'Unknown year'] : genres(cd).length ? genres(cd) : ['Uncategorized'];
      for (const key of keys) {
        if (!map.has(key)) map.set(key, []);
        map.get(key).push(cd);
      }
    }
    return [...map.entries()].sort(([a], [b]) => view === 'years' ? b.localeCompare(a) : a.localeCompare(b));
  }
  window.LibraryUI = { icon, filter, groups, genres, label };
  document.querySelectorAll('[data-icon]').forEach(element => element.prepend(icon(element.dataset.icon)));
})();
