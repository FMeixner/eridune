/* Cartographie d'Eridune — Kartenwerkstatt v4
   Marker mit Wiki-Verknüpfung, localStorage + JSON + optionaler GitHub-Sync.
   Kein Build-Schritt, keine Abhängigkeiten. */
(function () {
  'use strict';

  const LS = 'eridune-werkstatt-v4';
  const TYPEN = {
    stadt:      { label: 'Stadt',           farbe: '#e6c86a' },
    dorf:       { label: 'Dorf',            farbe: '#d8c9a0' },
    grenze:     { label: 'Grenze/Festung',  farbe: '#c96a5a' },
    ruine:      { label: 'Ruine',           farbe: '#a08a72' },
    verkehr:    { label: 'Verkehrsweg',     farbe: '#8ab0c8' },
    natur:      { label: 'Naturmarke',      farbe: '#7aa86a' },
    wald:       { label: 'Wald',            farbe: '#56845a' },
    gebirge:    { label: 'Gebirge',         farbe: '#8d8d8d' },
    gewaesser:  { label: 'Gewässer',        farbe: '#5a9ab0' },
    geheimnis:  { label: 'Geheimnis',       farbe: '#a56ac8' },
    kult:       { label: 'Kultstätte',      farbe: '#b04a6a' },
    untergrund: { label: 'Untergrund',      farbe: '#7a6a5a' },
    artefakt:   { label: 'Artefakt',        farbe: '#d4a45c' },
    ziel:       { label: 'Ziel',            farbe: '#e0d060' }
  };
  const DEFAULTS = {
    version: 4,
    updated: null,
    markers: [],
    settings: {
      mapUrl: '',
      mapData: null,
      wikiBase: 'https://fmeixner.github.io/eridune/',
      gh: { owner: 'FMeixner', repo: 'eridune', branch: 'v5', path: 'content/werkstatt/werkstatt-daten.json', token: '' }
    }
  };

  let state = null;
  let mode = 'pan';
  let sel = null;            // aktuell ausgewählter Marker
  let typeFilter = null;     // null = alle
  let sitemapPages = null;
  let imgW = 0, imgH = 0;
  const view = { s: 1, tx: 0, ty: 0 };

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  /* ---------- Toast ---------- */
  let toastTimer = null;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 3500);
  }

  /* ---------- State ---------- */
  function loadState() {
    try { const raw = localStorage.getItem(LS); return raw ? JSON.parse(raw) : null; }
    catch (e) { return null; }
  }
  function saveState() {
    state.updated = new Date().toISOString();
    try { localStorage.setItem(LS, JSON.stringify(state)); }
    catch (e) { toast('Lokal speichern fehlgeschlagen (Speicher voll?) — Kartenbild verkleinern oder exportieren.'); }
  }
  function mergeSettings(remote) {
    const local = state ? state.settings : null;
    const gh = Object.assign({}, DEFAULTS.settings.gh, (remote && remote.gh) || {});
    if (local && local.gh && local.gh.token) gh.token = local.gh.token;
    const s = Object.assign({}, DEFAULTS.settings, remote || {});
    s.gh = gh;
    if (local && local.mapData) s.mapData = local.mapData;
    return s;
  }
  function adopt(data, quiet) {
    state = {
      version: 4,
      updated: data.updated || null,
      markers: (data.markers || []).map(normalizeMarker),
      settings: mergeSettings(data.settings)
    };
    saveState();
    renderAll();
    if (!quiet) toast(data.markers ? data.markers.length + ' Marker übernommen.' : 'Daten übernommen.');
  }
  function normalizeMarker(m) {
    return {
      id: m.id || uid(),
      label: m.label || 'Ohne Namen',
      typ: TYPEN[m.typ] ? m.typ : (TYPEN[m.type] ? m.type : 'natur'),  // v3-Kompatibilität: type → typ
      wiki: m.wiki || '',
      url: m.url || (m.lotse && !m.wiki ? m.lotse : ''),                // v3-Kompatibilität: lotse → url
      notiz: m.notiz || '',
      x: Number.isFinite(+m.x) ? +m.x : 50,
      y: Number.isFinite(+m.y) ? +m.y : 50
    };
  }

  /* ---------- Wiki-URL ---------- */
  function wikiUrl(m) {
    if (m.url) return m.url;
    if (!m.wiki) return '';
    const base = (state.settings.wikiBase || DEFAULTS.settings.wikiBase).replace(/\/?$/, '/');
    return base + encodeURIComponent(m.wiki).replace(/%20/g, '-');
  }

  /* ---------- Karte: Pan & Zoom ---------- */
  function applyView() {
    $('world').style.transform = 'translate(' + view.tx + 'px,' + view.ty + 'px) scale(' + view.s + ')';
  }
  function zoomAt(mx, my, f) {
    const ns = clamp(view.s * f, 0.12, 10);
    const rf = ns / view.s;
    view.tx = mx - (mx - view.tx) * rf;
    view.ty = my - (my - view.ty) * rf;
    view.s = ns;
    applyView();
  }
  function fitView() {
    if (!imgW || !imgH) return;
    const r = $('map').getBoundingClientRect();
    const s = clamp(Math.min(r.width / imgW, r.height / imgH), 0.12, 10);
    view.s = s;
    view.tx = (r.width - imgW * s) / 2;
    view.ty = (r.height - imgH * s) / 2;
    applyView();
  }
  function gotoMarker(m) {
    if (!imgW) return;
    const r = $('map').getBoundingClientRect();
    const s = Math.max(view.s, 1.2);
    view.s = s;
    view.tx = r.width / 2 - (m.x / 100) * imgW * s;
    view.ty = r.height / 2 - (m.y / 100) * imgH * s;
    applyView();
  }
  function percentFromEvent(e) {
    const r = $('world').getBoundingClientRect();
    return {
      x: clamp(((e.clientX - r.left) / r.width) * 100, 0, 100),
      y: clamp(((e.clientY - r.top) / r.height) * 100, 0, 100)
    };
  }

  /* ---------- Marker ---------- */
  function addMarkerAt(p) {
    const m = normalizeMarker({ id: uid(), label: '', typ: 'geheimnis', x: p.x, y: p.y });
    state.markers.push(m);
    saveState();
    renderMarkers();
    renderList();
    selectMarker(m.id, true);
  }
  function selectMarker(id, focusEditor) {
    sel = id;
    renderMarkers();
    renderList();
    openEditor();
    if (focusEditor) setTimeout(() => $('eLabel').focus(), 30);
  }
  function deleteMarker(id) {
    const m = state.markers.find((x) => x.id === id);
    if (!m) return;
    if (!confirm('Marker „' + (m.label || 'Ohne Namen') + '“ löschen?')) return;
    state.markers = state.markers.filter((x) => x.id !== id);
    if (sel === id) { sel = null; closeEditor(); }
    saveState();
    renderMarkers();
    renderList();
    toast('Marker gelöscht.');
  }

  /* ---------- Rendering ---------- */
  function renderAll() {
    applyMap();
    renderTypeSelect();
    renderChips();
    renderMarkers();
    renderList();
  }
  function applyMap() {
    const img = $('mapimg');
    const s = state.settings;
    imgW = 0; imgH = 0;
    $('world').classList.add('empty');
    $('maphint').hidden = true;
    const src = s.mapData || s.mapUrl || '';
    if (!src) { $('maphint').hidden = false; img.removeAttribute('src'); return; }
    img.onload = () => {
      imgW = img.naturalWidth; imgH = img.naturalHeight;
      $('world').classList.remove('empty');
      $('maphint').hidden = true;
      $('world').style.width = imgW + 'px';
      fitView();
    };
    img.onerror = () => { $('maphint').hidden = false; toast('Kartenbild konnte nicht geladen werden: ' + src); };
    img.src = src;
  }
  function renderTypeSelect() {
    const selEl = $('eTyp');
    selEl.innerHTML = Object.keys(TYPEN).map((k) =>
      '<option value="' + k + '">' + esc(TYPEN[k].label) + '</option>').join('');
  }
  function renderChips() {
    const present = {};
    state.markers.forEach((m) => { present[m.typ] = (present[m.typ] || 0) + 1; });
    const keys = Object.keys(present);
    let html = '<span class="chip' + (typeFilter === null ? ' on' : '') + '" data-t="">Alle (' + state.markers.length + ')</span>';
    keys.forEach((k) => {
      html += '<span class="chip' + (typeFilter === k ? ' on' : '') + '" data-t="' + k + '">' +
        esc(TYPEN[k] ? TYPEN[k].label : k) + ' (' + present[k] + ')</span>';
    });
    $('typechips').innerHTML = html;
  }
  function visibleMarkers() {
    const q = $('search').value.trim().toLowerCase();
    return state.markers.filter((m) => {
      if (typeFilter && m.typ !== typeFilter) return false;
      if (q && !(String(m.label).toLowerCase().includes(q) || String(m.notiz).toLowerCase().includes(q) || String(m.wiki).toLowerCase().includes(q))) return false;
      return true;
    });
  }
  function renderMarkers() {
    const world = $('world');
    world.querySelectorAll('.marker').forEach((el) => el.remove());
    const frag = document.createDocumentFragment();
    state.markers.forEach((m) => {
      const el = document.createElement('div');
      el.className = 'marker' + (sel === m.id ? ' sel' : '');
      el.dataset.id = m.id;
      el.style.left = m.x + '%';
      el.style.top = m.y + '%';
      el.title = m.label + (m.notiz ? ' — ' + m.notiz : '');
      const farbe = TYPEN[m.typ] ? TYPEN[m.typ].farbe : '#7aa86a';
      el.innerHTML = '<span class="dot" style="background:' + farbe + '"></span>' +
        (m.label ? '<span class="mlabel">' + esc(m.label) + '</span>' : '');
      frag.appendChild(el);
    });
    world.appendChild(frag);
  }
  function renderList() {
    const vis = visibleMarkers();
    const list = $('mlist');
    list.innerHTML = vis.map((m) => {
      const farbe = TYPEN[m.typ] ? TYPEN[m.typ].farbe : '#7aa86a';
      const linked = m.wiki || m.url;
      const link = linked
        ? '<a href="' + esc(wikiUrl(m)) + '" target="_blank" rel="noopener" title="Wiki-Seite öffnen" data-nav="1">↗</a>'
        : '<span style="color:#5a5a4a" title="Ohne Wiki-Link">·</span>';
      return '<div class="mrow' + (sel === m.id ? ' sel' : '') + '" data-id="' + m.id + '">' +
        '<span class="mdot" style="background:' + farbe + '"></span>' +
        '<span class="mlabel">' + esc(m.label || '(unbenannt)') + '</span>' + link + '</div>';
    }).join('');
    $('mcount').textContent = state.markers.length + ' Marker gesamt' +
      (vis.length !== state.markers.length ? ' · ' + vis.length + ' sichtbar' : '');
  }

  /* ---------- Editor ---------- */
  function openEditor() {
    const m = state.markers.find((x) => x.id === sel);
    if (!m) { closeEditor(); return; }
    $('editor').hidden = false;
    $('eTitle').textContent = m.label || 'Neuer Marker';
    $('eLabel').value = m.label || '';
    $('eTyp').value = m.typ;
    $('eWiki').value = m.wiki || '';
    $('eUrl').value = m.url || '';
    $('eNotiz').value = m.notiz || '';
    $('ePos').value = m.x.toFixed(1) + ' % / ' + m.y.toFixed(1) + ' %';
    loadSitemap();
  }
  function closeEditor() { $('editor').hidden = true; }
  function editorInput() {
    const m = state.markers.find((x) => x.id === sel);
    if (!m) return;
    m.label = $('eLabel').value;
    m.typ = $('eTyp').value;
    m.wiki = $('eWiki').value.trim();
    m.url = $('eUrl').value.trim();
    m.notiz = $('eNotiz').value;
    saveState();
    renderMarkers();
    renderList();
    renderChips();
    $('eTitle').textContent = m.label || 'Neuer Marker';
  }

  /* ---------- Sitemap (Wiki-Autocomplete) ---------- */
  function loadSitemap() {
    if (sitemapPages) return;
    const base = (state.settings.wikiBase || '').replace(/\/?$/, '/');
    fetch(base + 'sitemap.xml')
      .then((r) => r.ok ? r.text() : Promise.reject())
      .then((txt) => {
        const urls = Array.from(txt.matchAll(/<loc>([^<]+)<\/loc>/g)).map((x) => x[1]);
        sitemapPages = urls
          .map((u) => decodeURIComponent(u.replace(base, '').replace(/\/$/, '')))
          .filter((t) => t && t !== 'index' && !t.startsWith('tags') && !t.startsWith('authors'));
        $('wikilist').innerHTML = sitemapPages.map((t) => '<option value="' + esc(t) + '"></option>').join('');
      })
      .catch(() => { sitemapPages = []; });
  }

  /* ---------- GitHub-Sync ---------- */
  function ghCfg() { return state.settings.gh; }
  function ghApi() { return 'https://api.github.com/repos/' + ghCfg().owner + '/' + ghCfg().repo; }
  function b64(str) { return btoa(unescape(encodeURIComponent(str))); }
  function dataFile() {
    return {
      version: 4,
      updated: state.updated,
      markers: state.markers,
      settings: { mapUrl: state.settings.mapUrl, wikiBase: state.settings.wikiBase }
    };
  }
  async function ghSave() {
    const c = ghCfg();
    if (!c.token) { toast('Kein GitHub-Token gesetzt — Einstellungen ⚙ öffnen.'); openSettings(); return; }
    toast('Speichere …');
    try {
      let sha = null;
      const get = await fetch(ghApi() + '/contents/' + c.path + '?ref=' + encodeURIComponent(c.branch) + '&_=' + Date.now(), {
        headers: ghHeaders()
      });
      if (get.ok) sha = (await get.json()).sha;
      else if (get.status !== 404) throw new Error('GitHub-Check: HTTP ' + get.status);
      const put = await fetch(ghApi() + '/contents/' + c.path, {
        method: 'PUT',
        headers: ghHeaders(),
        body: JSON.stringify({
          message: 'Kartenwerkstatt: ' + state.markers.length + ' Marker (' + new Date().toLocaleDateString('de-DE') + ')',
          branch: c.branch,
          content: b64(JSON.stringify(dataFile(), null, 2)),
          sha: sha || undefined
        })
      });
      if (!put.ok) {
        const err = await put.json().catch(() => ({}));
        throw new Error(err.message || ('HTTP ' + put.status));
      }
      toast('Gespeichert: ' + state.markers.length + ' Marker im Repo.');
    } catch (e) { toast('GitHub-Speichern fehlgeschlagen: ' + e.message); }
  }
  function ghHeaders() {
    return {
      'Authorization': 'Bearer ' + ghCfg().token,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28'
    };
  }
  async function ghLoad() {
    const c = ghCfg();
    const raw = 'https://raw.githubusercontent.com/' + c.owner + '/' + c.repo + '/' + c.branch + '/' + c.path;
    try {
      const r = await fetch(raw + '?_=' + Date.now());
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      if (!data || !Array.isArray(data.markers)) throw new Error('Datei enthält keine Marker.');
      if (state.markers.length && !confirm('Lokale Daten durch Repo-Stand ersetzen? (' + data.markers.length + ' Marker im Repo, ' + state.markers.length + ' lokal)')) return;
      adopt(data, true);
      toast('Repo-Stand geladen: ' + data.markers.length + ' Marker.');
    } catch (e) { toast('GitHub-Laden fehlgeschlagen: ' + e.message + ' (Branch/Pfad korrekt?)'); }
  }
  async function ghCommitMap(dataUrl, mime) {
    const c = ghCfg();
    if (!c.token) { toast('Kein GitHub-Token gesetzt — Einstellungen ⚙ öffnen.'); openSettings(); return; }
    const ext = (mime || 'image/png').split('/')[1] === 'jpeg' ? 'jpg' : ((mime || 'image/png').split('/')[1] || 'png');
    const path = 'content/werkstatt/karte.' + ext;
    toast('Lade Kartenbild hoch …');
    try {
      let sha = null;
      const get = await fetch(ghApi() + '/contents/' + path + '?ref=' + encodeURIComponent(c.branch), { headers: ghHeaders() });
      if (get.ok) sha = (await get.json()).sha;
      const put = await fetch(ghApi() + '/contents/' + path, {
        method: 'PUT',
        headers: ghHeaders(),
        body: JSON.stringify({
          message: 'Kartenwerkstatt: neues Kartenbild',
          branch: c.branch,
          content: dataUrl.split(',')[1],
          sha: sha || undefined
        })
      });
      if (!put.ok) throw new Error('HTTP ' + put.status);
      state.settings.mapUrl = './karte.' + ext;
      state.settings.mapData = null;
      saveState();
      applyMap();
      toast('Kartenbild committet: ' + path + ' — nach dem Deploy ist es unter /werkstatt/karte.' + ext + ' verfügbar.');
    } catch (e) { toast('Kartenbild-Commit fehlgeschlagen: ' + e.message); }
  }

  /* ---------- Import / Export ---------- */
  function exportJson() {
    const data = dataFile();
    data.settings.mapUrl = state.settings.mapUrl;
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'eridune-werkstatt-daten.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    toast('Export erstellt (Token und lokales Kartenbild ausgeschlossen).');
  }
  function importJson(file) {
    file.text().then((txt) => {
      let data;
      try { data = JSON.parse(txt); } catch (e) { toast('Kein gültiges JSON.'); return; }
      const n = (data.markers || []).length;
      if (state.markers.length && !confirm('Import: ' + n + ' Marker — lokale Daten ersetzen? (Abbrechen = abbrechen)')) return;
      const isV3 = data.version !== 4 && (data.markers || []).some((m) => m.type || m.lotse);
      adopt(data, true);
      toast(isV3
        ? 'v3-Import übernommen (Positionen/% bleiben, lotse→URL). Routen/Kalibrierung ignoriert.'
        : n + ' Marker importiert.');
    });
  }

  /* ---------- Einstellungen ---------- */
  let pendingMapData = null;
  function openSettings() {
    const s = state.settings, c = s.gh;
    $('sMapUrl').value = s.mapUrl || '';
    $('sWikiBase').value = s.wikiBase || '';
    $('sRepo').value = c.owner + '/' + c.repo;
    $('sBranch').value = c.branch;
    $('sPath').value = c.path;
    $('sToken').value = c.token || '';
    pendingMapData = null;
    $('sPreview').style.display = 'none';
    $('settings').showModal();
  }
  function saveSettings() {
    const s = state.settings;
    s.mapUrl = $('sMapUrl').value.trim();
    s.wikiBase = $('sWikiBase').value.trim().replace(/\/?$/, '/');
    const repo = $('sRepo').value.trim().split('/');
    s.gh.owner = repo[0] || DEFAULTS.settings.gh.owner;
    s.gh.repo = repo[1] || DEFAULTS.settings.gh.repo;
    s.gh.branch = $('sBranch').value.trim() || DEFAULTS.settings.gh.branch;
    s.gh.path = $('sPath').value.trim() || DEFAULTS.settings.gh.path;
    s.gh.token = $('sToken').value.trim();
    if (pendingMapData) { s.mapData = pendingMapData; s.mapUrl = ''; }
    saveState();
    applyMap();
    $('settings').close();
    toast('Einstellungen gespeichert.');
  }

  /* ---------- Interaktion: Karte ---------- */
  function setMode(m) {
    mode = m;
    $('map').dataset.mode = m;
    ['bPan', 'bPlace', 'bMove'].forEach((id) => $(id).classList.remove('active'));
    $({ pan: 'bPan', place: 'bPlace', move: 'bMove' }[m]).classList.add('active');
  }
  function initMapEvents() {
    const mapEl = $('map'), world = $('world');
    let dragging = false, moving = null, moved = false, sx = 0, sy = 0, vx = 0, vy = 0;

    mapEl.addEventListener('pointerdown', (e) => {
      if (e.target.closest('#editor') || e.target.closest('dialog')) return;
      const mEl = e.target.closest('.marker');
      if (mEl && mode === 'move') {
        moving = state.markers.find((x) => x.id === mEl.dataset.id);
        moved = false;
      } else if (mEl) {
        selectMarker(mEl.dataset.id);
        return;
      } else if (mode === 'place') {
        // Klick (kein Drag) setzt später den Marker — Drag erlaubt trotzdem Pan.
        dragging = true; moved = false; sx = e.clientX; sy = e.clientY; vx = view.tx; vy = view.ty;
      } else {
        dragging = true; moved = false; sx = e.clientX; sy = e.clientY; vx = view.tx; vy = view.ty;
        mapEl.setPointerCapture(e.pointerId);
      }
      e.preventDefault();
    });
    mapEl.addEventListener('pointermove', (e) => {
      if (moving) {
        const p = percentFromEvent(e);
        moving.x = p.x; moving.y = p.y;
        const el = world.querySelector('.marker[data-id="' + moving.id + '"]');
        if (el) { el.style.left = p.x + '%'; el.style.top = p.y + '%'; }
        $('ePos').value = p.x.toFixed(1) + ' % / ' + p.y.toFixed(1) + ' %';
        moved = true;
      } else if (dragging) {
        const dx = e.clientX - sx, dy = e.clientY - sy;
        if (Math.abs(dx) + Math.abs(dy) > 4) moved = true;
        view.tx = vx + dx; view.ty = vy + dy;
        applyView();
      }
    });
    mapEl.addEventListener('pointerup', (e) => {
      if (moving) {
        if (moved) { saveState(); renderList(); toast('Position gespeichert.'); }
        moving = null;
      } else if (dragging) {
        if (mode === 'place' && !moved) { const p = percentFromEvent(e); addMarkerAt(p); }
        dragging = false;
      }
    });
    mapEl.addEventListener('wheel', (e) => {
      e.preventDefault();
      const r = mapEl.getBoundingClientRect();
      zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(-e.deltaY * 0.0016));
    }, { passive: false });
    world.addEventListener('dblclick', (e) => {
      const mEl = e.target.closest('.marker');
      if (!mEl) return;
      const m = state.markers.find((x) => x.id === mEl.dataset.id);
      const u = m && wikiUrl(m);
      if (u) window.open(u, '_blank', 'noopener');
    });
  }

  /* ---------- Interaktion: UI ---------- */
  function initUiEvents() {
    $('bPan').onclick = () => setMode('pan');
    $('bPlace').onclick = () => setMode('place');
    $('bMove').onclick = () => setMode('move');
    $('bFit').onclick = fitView;
    $('bNew').onclick = () => {
      if (!imgW) { toast('Erst ein Kartenbild hinterlegen (Einstellungen ⚙).'); openSettings(); return; }
      setMode('place');
      toast('Klicke auf die Karte, um den Marker zu setzen.');
    };
    $('bGhSave').onclick = ghSave;
    $('bGhLoad').onclick = ghLoad;
    $('bExport').onclick = exportJson;
    $('bImport').onclick = () => $('importFile').click();
    $('bSettings').onclick = openSettings;
    $('importFile').addEventListener('change', (e) => {
      if (e.target.files && e.target.files[0]) importJson(e.target.files[0]);
      e.target.value = '';
    });
    $('search').addEventListener('input', renderList);
    $('typechips').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      typeFilter = chip.dataset.t || null;
      renderChips();
      renderList();
    });
    $('mlist').addEventListener('click', (e) => {
      if (e.target.closest('a')) return;
      const row = e.target.closest('.mrow');
      if (!row) return;
      const m = state.markers.find((x) => x.id === row.dataset.id);
      if (!m) return;
      selectMarker(m.id);
      gotoMarker(m);
    });
    ['eLabel', 'eTyp', 'eWiki', 'eUrl', 'eNotiz'].forEach((id) =>
      $(id).addEventListener('input', editorInput));
    $('eOpen').onclick = () => {
      const m = state.markers.find((x) => x.id === sel);
      const u = m && wikiUrl(m);
      if (u) window.open(u, '_blank', 'noopener'); else toast('Kein Wiki-Link gesetzt.');
    };
    $('eGoto').onclick = () => {
      const m = state.markers.find((x) => x.id === sel);
      if (m) gotoMarker(m);
    };
    $('eDelete').onclick = () => sel && deleteMarker(sel);
    $('eClose').onclick = closeEditor;

    $('sCancel').onclick = () => $('settings').close();
    $('sSave').onclick = saveSettings;
    $('sMapFile').addEventListener('change', (e) => {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const r = new FileReader();
      r.onload = () => {
        pendingMapData = r.result;
        $('sPreview').src = r.result;
        $('sPreview').style.display = 'block';
        if (f.size > 2 * 1024 * 1024) toast('Warnung: Bild > 2 MB — für localStorage „Ins Repo committen“ bevorzugt.');
      };
      r.readAsDataURL(f);
    });
    $('sMapLocal').onclick = () => {
      if (!pendingMapData) { toast('Erst ein Bild auswählen.'); return; }
      state.settings.mapData = pendingMapData;
      state.settings.mapUrl = '';
      saveState(); applyMap(); $('settings').close();
      toast('Kartenbild lokal gesetzt (nur dieser Browser).');
    };
    $('sMapCommit').onclick = () => {
      if (!pendingMapData) { toast('Erst ein Bild auswählen.'); return; }
      ghCommitMap(pendingMapData, (pendingMapData.match(/^data:([^;]+);/) || [])[1]);
    };
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeEditor();
    });
    window.addEventListener('resize', fitView);
  }

  /* ---------- Start ---------- */
  async function init() {
    const stored = loadState();
    if (stored) {
      state = { version: 4, updated: stored.updated || null, markers: (stored.markers || []).map(normalizeMarker), settings: mergeSettings(stored.settings) };
    } else {
      try {
        const r = await fetch('./werkstatt-daten.json');
        const data = r.ok ? await r.json() : null;
        state = {
          version: 4, updated: data && data.updated,
          markers: data ? (data.markers || []).map(normalizeMarker) : [],
          settings: mergeSettings(data ? data.settings : null)
        };
      } catch (e) {
        state = JSON.parse(JSON.stringify(DEFAULTS));
      }
      saveState();
    }
    initMapEvents();
    initUiEvents();
    setMode('pan');
    renderAll();
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').catch(() => {});
    }
  }
  init();
})();
