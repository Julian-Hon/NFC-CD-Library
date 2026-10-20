// The hosted page talks to Supabase, never directly to a localhost USB port.
(() => {
  const dialog = document.querySelector('#readers-dialog');
  const status = document.querySelector('#readers-status');
  const list = document.querySelector('#readers-list');
  const button = document.createElement('button');
  button.textContent = 'My readers';
  document.querySelector('.account-popover').prepend(button);
  let busy = false, owner = null, readers = [], handled = new Map(), responses = new Map();
  const auth = () => window.cdLibraryAuth;
  function clearCredential() {
    document.querySelector('#reader-credential').value = '';
    document.querySelector('#reader-credential-panel').hidden = true;
  }
  function render() {
    list.replaceChildren();
    if (!readers.length) list.textContent = 'No readers paired yet.';
    for (const reader of readers) {
      const row = document.createElement('p');
      const online = reader.connected && Date.now() - Date.parse(reader.last_seen) < 15000;
      const text = document.createElement('span');
      text.textContent = `${reader.name} · ${online ? 'Connected' : 'Offline'} `;
      const revoke = document.createElement('button');
      revoke.textContent = 'Revoke';
      revoke.onclick = async () => {
        revoke.disabled = true;
        const { error } = await auth().client.from('library_readers').delete().eq('id', reader.id);
        if (error) { status.textContent = error.message; revoke.disabled = false; return; }
        readers = readers.filter(item => item.id !== reader.id);
        clearCredential(); render();
        status.textContent = 'Reader revoked. Its saved credential no longer works.';
      };
      row.append(text, revoke); list.append(row);
    }
  }
  async function poll() {
    if (busy || !auth()?.user) return;
    busy = true;
    const user = auth().user.id;
    try {
      const { data, error } = await auth().client.from('library_readers').select('id,name,last_seen,connected,scan_id,uid,scanned_at');
      if (error) throw error;
      if (auth()?.user?.id !== user) return;
      readers = data;
      if (dialog.open) render();
      const online = readers.filter(r => r.connected && Date.now() - Date.parse(r.last_seen) < 15000);
      // Local bridge remains the source when using its local website.
      if (!['localhost', '127.0.0.1'].includes(location.hostname)) {
        const indicator = document.querySelector('#reader-indicator');
        indicator.dataset.state = online.length ? 'connected' : 'offline';
        indicator.title = online.length ? `${online.length} paired reader connected` : 'No paired reader online. Open Account → My readers.';
        indicator.setAttribute('aria-label', indicator.title);
        document.querySelector('#reader-status').textContent = indicator.title;
      }
      for (const reader of [...readers].sort((a,b) => Date.parse(a.scanned_at || 0) - Date.parse(b.scanned_at || 0))) {
        if (!reader.scan_id) continue;
        const { data: link, error: linkError } = await auth().client.from('tag_links').select('cd_id').eq('uid', reader.uid).maybeSingle();
        if (linkError) throw linkError;
        let cd = null;
        if (link) {
          const result = await auth().client.from('cds').select('payload').eq('id', link.cd_id).maybeSingle();
          if (result.error) throw result.error;
          cd = result.data?.payload || null;
        }
        if (auth()?.user?.id !== user) return;
        const signature = JSON.stringify([reader.scan_id, cd]);
        if (responses.get(reader.id) !== signature) {
          const result = await auth().client.from('library_readers').update({response_scan_id: reader.scan_id, response_cd: cd}).eq('id', reader.id).eq('scan_id', reader.scan_id);
          if (result.error) throw result.error;
          responses.set(reader.id, signature);
        }
        if (handled.get(reader.id) !== reader.scan_id) {
          handled.set(reader.id, reader.scan_id);
          // Don't replay historical scans on login/page refresh.
          if (Date.now() - Date.parse(reader.scanned_at) < 30000) {
            window.dispatchEvent(new CustomEvent('cloud-reader-scan', {detail: {
              scan: {id: reader.scan_id, uid: reader.uid, scannedAt: reader.scanned_at},
              reader: {connected: true, port: reader.name}
            }}));
          }
        }
      }
    } catch (error) {
      status.textContent = `Reader service unavailable. Apply the reader-pairing SQL migration if not installed. ${error.message}`;
    } finally { busy = false; }
  }
  button.onclick = () => { document.querySelector('#profile-menu').open = false; dialog.showModal(); status.textContent = ''; void poll(); };
  document.querySelector('#readers-close').onclick = () => dialog.close();
  dialog.addEventListener('close', clearCredential);
  document.querySelector('#reader-pair-form').onsubmit = async event => {
    event.preventDefault();
    if (!auth()?.user) return;
    const create = document.querySelector('#reader-create'); create.disabled = true;
    const user = auth().user.id;
    clearCredential();
    try {
      const token = [...crypto.getRandomValues(new Uint8Array(32))].map(x => x.toString(16).padStart(2,'0')).join('');
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token)))].map(x => x.toString(16).padStart(2,'0')).join('');
      const id = crypto.randomUUID();
      const { error } = await auth().client.from('library_readers').insert({id, name: document.querySelector('#reader-name').value.trim(), token_hash: hash});
      if (error) throw error;
      if (auth()?.user?.id !== user) return;
      document.querySelector('#reader-credential').value = `${id}:${token}`;
      document.querySelector('#reader-credential-panel').hidden = false;
      status.textContent = 'Reader created. Finish pairing on the USB computer below.';
      await poll();
    } catch (error) { status.textContent = `Could not pair reader: ${error.message}`; }
    finally { create.disabled = false; }
  };
  window.addEventListener('cd-library-auth-change', () => {
    if (owner !== auth()?.user?.id) {
      owner = auth()?.user?.id; readers = []; handled.clear(); responses.clear(); clearCredential();
      if (dialog.open) dialog.close();
    }
    void poll();
  });
  setInterval(poll, 2500);
  void poll();
})();
