(function () {
  'use strict';

  const Store = window.VoziaStore;

  const AMENITY_LABELS = {
    ac: '❄️ Климатик',
    nosmoke: '🚭 Без пушене',
    luggage: '🧳 Голям багаж',
    instant: '⚡ Незабавно',
    pets: '🐾 Любимци'
  };

  const state = {
    activeView: 'explore',
    tripsTab: 'booked',
    selectedRideId: null,
    activeThreadId: null,
    chips: new Set(),
    mapInstance: null,
    pendingIntent: null,
    wsConnected: false
  };

  document.addEventListener('DOMContentLoaded', async () => {
    populateCitiesDatalist();
    bindAuthEvents();
    bindAppEvents();
    applyURLParams();
    await checkAuthAndRoute();
  });

  /* ==================== AUTH GUARD ==================== */
  async function checkAuthAndRoute() {
    const authGate = document.getElementById('auth-gate');
    const appShell = document.getElementById('app-shell');

    let user = null;
    if (Store.getToken()) {
      user = await Store.syncProfile();
    }

    if (!user) {
      authGate.classList.remove('hidden');
      appShell.classList.add('hidden');
      return;
    }

    authGate.classList.add('hidden');
    appShell.classList.remove('hidden');

    syncUserUI(user);
    ensureMapReady();

    try {
      await Store.fetchRides();
      await Store.syncProfile();
    } catch (err) {
      showToast(err.message || 'Грешка при зареждане на данните.', 'error');
    }

    renderAll();
    connectWebSocket();

    if (state.pendingIntent === 'publish') {
      state.pendingIntent = null;
      openPublishModal();
    }
  }

  function applyURLParams() {
    const params = new URLSearchParams(window.location.search);
    if (params.get('mode') === 'register') {
      switchAuthTab('register');
    }
    if (params.get('from')) {
      document.getElementById('filter-from').value = params.get('from');
    }
    if (params.get('to')) {
      document.getElementById('filter-to').value = params.get('to');
    }
    if (params.get('date')) {
      document.getElementById('filter-date').value = params.get('date');
    }
    if (params.get('seats')) {
      document.getElementById('filter-seats').value = params.get('seats');
    }
    if (params.get('intent')) {
      state.pendingIntent = params.get('intent');
    }
  }

  function switchAuthTab(tab) {
    document.querySelectorAll('.auth-tab').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.authTab === tab);
    });
    const loginForm = document.getElementById('login-form');
    const regForm = document.getElementById('register-form');
    const title = document.getElementById('auth-title');
    const errBox = document.getElementById('auth-error');
    errBox.classList.add('hidden');

    if (tab === 'register') {
      loginForm.classList.add('hidden');
      regForm.classList.remove('hidden');
      title.textContent = 'Създай акаунт във Vozia';
    } else {
      regForm.classList.add('hidden');
      loginForm.classList.remove('hidden');
      title.textContent = 'Добре дошъл обратно';
    }
  }

  function showAuthError(msg) {
    const errBox = document.getElementById('auth-error');
    errBox.textContent = msg;
    errBox.classList.remove('hidden');
  }

  function bindAuthEvents() {
    document.querySelectorAll('.auth-tab').forEach((btn) => {
      btn.addEventListener('click', () => switchAuthTab(btn.dataset.authTab));
    });

    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const username = document.getElementById('login-username').value;
      const password = document.getElementById('login-password').value;
      const res = await Store.login(username, password);
      if (!res.ok) {
        showAuthError(res.error);
        return;
      }
      showToast(`Добре дошъл, ${res.user.name.split(' ')[0]}!`, 'success');
      await checkAuthAndRoute();
    });

    document.getElementById('register-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const res = await Store.register({
        name: document.getElementById('reg-name').value,
        username: document.getElementById('reg-username').value,
        phone: document.getElementById('reg-phone').value,
        car: document.getElementById('reg-car').value,
        password: document.getElementById('reg-password').value
      });
      if (!res.ok) {
        showAuthError(res.error);
        return;
      }
      showToast('Профилът ти е създаден успешно!', 'success');
      await checkAuthAndRoute();
    });

    document.getElementById('demo-login-btn').addEventListener('click', async () => {
      const res = await Store.loginDemo();
      if (!res.ok) {
        showAuthError(res.error);
        return;
      }
      showToast(`Влезе с демо профил (${res.user.name})`, 'success');
      await checkAuthAndRoute();
    });

    document.getElementById('admin-login-btn').addEventListener('click', async () => {
      const res = await Store.loginAdmin();
      if (!res.ok) {
        showAuthError(res.error);
        return;
      }
      showToast('Влезе като Администратор', 'success');
      await checkAuthAndRoute();
    });
  }

  /* ==================== APP EVENTS ==================== */
  function populateCitiesDatalist() {
    const dl = document.getElementById('app-cities-datalist');
    if (!dl) return;
    dl.innerHTML = Object.keys(Store.BG_CITIES)
      .map((city) => `<option value="${Store.escapeHTML(city)}"></option>`)
      .join('');
  }

  function ensureMapReady() {
    if (!state.mapInstance) {
      state.mapInstance = new window.VoziaMap('vozia-map', (rideId) => {
        selectRide(rideId, true);
      });
    }
    state.mapInstance.init();
  }

  function bindAppEvents() {
    document.querySelectorAll('.app-nav-btn').forEach((btn) => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    document.getElementById('header-user-pill').addEventListener('click', () => switchView('profile'));

    const handleLogout = async () => {
      Store.logout();
      state.selectedRideId = null;
      state.activeThreadId = null;
      if (state.mapInstance) state.mapInstance.clearRoute();
      showToast('Излезе от профила си.');
      await checkAuthAndRoute();
    };
    document.getElementById('logout-btn').addEventListener('click', handleLogout);
    document.getElementById('profile-logout-btn').addEventListener('click', handleLogout);

    ['filter-from', 'filter-to', 'filter-date', 'filter-seats', 'filter-max-price', 'filter-sort'].forEach(
      (id) => {
        const el = document.getElementById(id);
        el.addEventListener('input', renderExplore);
        el.addEventListener('change', renderExplore);
      }
    );

    document.getElementById('swap-cities-btn').addEventListener('click', () => {
      const f = document.getElementById('filter-from');
      const t = document.getElementById('filter-to');
      const tmp = f.value;
      f.value = t.value;
      t.value = tmp;
      renderExplore();
    });

    document.getElementById('reset-filters-btn').addEventListener('click', () => {
      document.getElementById('filter-from').value = '';
      document.getElementById('filter-to').value = '';
      document.getElementById('filter-date').value = '';
      document.getElementById('filter-seats').value = '1';
      document.getElementById('filter-max-price').value = '999';
      document.getElementById('filter-sort').value = 'soonest';
      state.chips.clear();
      document.querySelectorAll('#amenity-chips .chip').forEach((c) => c.classList.remove('active'));
      renderExplore();
    });

    document.querySelectorAll('#amenity-chips .chip').forEach((chip) => {
      chip.addEventListener('click', () => {
        const key = chip.dataset.chip;
        if (state.chips.has(key)) {
          state.chips.delete(key);
          chip.classList.remove('active');
        } else {
          state.chips.add(key);
          chip.classList.add('active');
        }
        renderExplore();
      });
    });

    document.querySelectorAll('.map-style-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.map-style-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        if (state.mapInstance) state.mapInstance.setStyle(btn.dataset.mapStyle);
      });
    });

    document.getElementById('hud-open-details').addEventListener('click', () => {
      if (state.selectedRideId) openRideModal(state.selectedRideId);
    });

    const split = document.getElementById('explore-split');
    const mobList = document.getElementById('mob-btn-list');
    const mobMap = document.getElementById('mob-btn-map');

    mobList.addEventListener('click', () => {
      split.classList.add('mobile-show-list');
      split.classList.remove('mobile-show-map');
      mobList.classList.replace('btn-outline', 'btn-dark');
      mobMap.classList.replace('btn-dark', 'btn-outline');
    });

    mobMap.addEventListener('click', () => {
      split.classList.add('mobile-show-map');
      split.classList.remove('mobile-show-list');
      mobMap.classList.replace('btn-outline', 'btn-dark');
      mobList.classList.replace('btn-dark', 'btn-outline');
      setTimeout(() => {
        if (state.mapInstance) state.mapInstance.resize();
      }, 60);
    });

    document.getElementById('open-publish-btn').addEventListener('click', openPublishModal);
    document.getElementById('trips-publish-btn').addEventListener('click', openPublishModal);
    document.getElementById('publish-form').addEventListener('submit', handlePublishSubmit);

    document.querySelectorAll('[data-close-modal]').forEach((btn) => {
      btn.addEventListener('click', () => closeModal(btn.dataset.closeModal));
    });
    document.querySelectorAll('.modal-backdrop').forEach((backdrop) => {
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) backdrop.classList.add('hidden');
      });
    });

    document.querySelectorAll('[data-trips-tab]').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.tripsTab = btn.dataset.tripsTab;
        document.querySelectorAll('[data-trips-tab]').forEach((b) => {
          b.classList.toggle('active', b.dataset.tripsTab === state.tripsTab);
        });
        renderTrips();
      });
    });

    document.getElementById('chat-form').addEventListener('submit', handleChatSubmit);
    document.getElementById('profile-form').addEventListener('submit', handleProfileSubmit);
  }

  /* ==================== WEBSOCKET LIVE SYNC ==================== */
  function connectWebSocket() {
    if (state.wsConnected) return;
    const proto = window.location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${window.location.host}/ws`);

    ws.onopen = () => {
      state.wsConnected = true;
    };

    ws.onmessage = async (evt) => {
      try {
        const msg = JSON.parse(evt.data);
        if (msg && msg.event === 'rides_updated' && Store.getToken()) {
          await Store.fetchRides();
          await Store.syncProfile();
          renderAll();
        }
      } catch (_) {}
    };

    ws.onclose = () => {
      state.wsConnected = false;
      if (Store.getToken()) {
        setTimeout(connectWebSocket, 3000);
      }
    };
  }

  /* ==================== NAVIGATION & SYNC ==================== */
  async function switchView(viewName) {
    state.activeView = viewName;
    document.querySelectorAll('.app-nav-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });
    document.querySelectorAll('.app-view').forEach((v) => v.classList.add('hidden'));
    const target = document.getElementById(`view-${viewName}`);
    if (target) target.classList.remove('hidden');

    if (viewName === 'explore') {
      renderExplore();
      setTimeout(() => {
        if (state.mapInstance) state.mapInstance.resize();
      }, 60);
    } else if (viewName === 'trips') {
      await Store.syncProfile();
      renderTrips();
    } else if (viewName === 'messages') {
      renderMessages();
    } else if (viewName === 'profile') {
      await Store.syncProfile();
      renderProfile();
    } else if (viewName === 'admin') {
      await renderAdmin();
    }
  }

  function syncUserUI(user) {
    document.getElementById('header-avatar').textContent = Store.getInitials(user.name);
    document.getElementById('header-user-name').textContent =
      user.role === 'admin' ? `${user.name.split(' ')[0]} (Админ)` : user.name.split(' ')[0];

    const adminBtn = document.getElementById('nav-admin-btn');
    if (adminBtn) {
      adminBtn.classList.toggle('hidden', user.role !== 'admin');
    }
    updateNavBadges();
  }

  function updateNavBadges() {
    const user = Store.getCurrentUser();
    if (!user) return;
    const totalTrips = Store.myBookingsCache.length + Store.myRidesCache.length;

    const tripsBadge = document.getElementById('badge-trips');
    tripsBadge.textContent = totalTrips;
    tripsBadge.classList.toggle('hidden', totalTrips === 0);

    const threadsCount = Store.getThreads(user.id).length;
    const msgBadge = document.getElementById('badge-messages');
    msgBadge.textContent = threadsCount;
    msgBadge.classList.toggle('hidden', threadsCount === 0);
  }

  function renderAll() {
    renderExplore();
    renderTrips();
    renderMessages();
    renderProfile();
    if (state.activeView === 'admin') renderAdmin();
    updateNavBadges();
  }

  /* ==================== EXPLORE & MAP ==================== */
  function getFilteredRides() {
    const fromVal = document.getElementById('filter-from').value.trim().toLowerCase();
    const toVal = document.getElementById('filter-to').value.trim().toLowerCase();
    const dateVal = document.getElementById('filter-date').value;
    const minSeats = Number(document.getElementById('filter-seats').value || 1);
    const maxPrice = Number(document.getElementById('filter-max-price').value || 999);
    const sortBy = document.getElementById('filter-sort').value;

    let rides = Store.getRides().filter((r) => {
      if (r.status === 'cancelled') return false;
      if (r.seatsLeft < minSeats) return false;
      if (r.price > maxPrice) return false;

      const stopNames = (r.stops || []).map((s) => s.name.toLowerCase()).join(' ');
      if (fromVal && !r.from.toLowerCase().includes(fromVal) && !stopNames.includes(fromVal)) {
        return false;
      }
      if (toVal && !r.to.toLowerCase().includes(toVal) && !stopNames.includes(toVal)) {
        return false;
      }
      if (dateVal && r.date !== dateVal) return false;

      for (const chip of state.chips) {
        if (chip === 'stops' && (!r.stops || r.stops.length === 0)) return false;
        if (chip !== 'stops' && !(r.amenities || []).includes(chip)) return false;
      }
      return true;
    });

    if (sortBy === 'cheapest') {
      rides.sort((a, b) => a.price - b.price);
    } else if (sortBy === 'seats') {
      rides.sort((a, b) => b.seatsLeft - a.seatsLeft);
    } else {
      rides.sort((a, b) => `${a.date} ${a.time}`.localeCompare(`${b.date} ${b.time}`));
    }

    return rides;
  }

  function renderExplore() {
    const rides = getFilteredRides();
    const listEl = document.getElementById('rides-list');
    document.getElementById('rides-count-label').textContent = `Намерени пътувания: ${rides.length}`;

    if (rides.length === 0) {
      listEl.innerHTML = `
        <div class="empty-state">
          <div style="font-size:1.8rem; margin-bottom:8px;">🔎</div>
          <p style="font-weight:700; color:var(--slate-800); margin-bottom:6px;">Няма намерени пътувания по тези критерии</p>
          <p style="font-size:0.86rem; margin-bottom:14px;">Пробвай да изчистиш част от филтрите или публикувай свое пътуване.</p>
          <button type="button" class="btn btn-primary btn-sm" id="empty-publish-cta">+ Предложи пътуване</button>
        </div>
      `;
      const cta = document.getElementById('empty-publish-cta');
      if (cta) cta.addEventListener('click', openPublishModal);
      if (state.mapInstance) {
        state.mapInstance.renderRideMarkers([], null);
        state.mapInstance.clearRoute();
      }
      document.getElementById('map-route-hud').classList.add('hidden');
      return;
    }

    if (!state.selectedRideId || !rides.some((r) => String(r.id) === String(state.selectedRideId))) {
      state.selectedRideId = rides[0].id;
    }

    listEl.innerHTML = rides
      .map((r) => {
        const isSelected = String(r.id) === String(state.selectedRideId);
        const stopsLine =
          r.stops && r.stops.length
            ? `<div style="font-size:0.79rem; color:var(--brand-700); font-weight:600; margin-top:3px;">📍 През: ${r.stops.map((s) => Store.escapeHTML(s.name)).join(', ')}</div>`
            : '';

        const badges = (r.amenities || [])
          .slice(0, 3)
          .map((a) => `<span class="badge">${AMENITY_LABELS[a] || a}</span>`)
          .join('');

        return `
          <article class="ride-card ${isSelected ? 'selected' : ''}" data-ride-id="${r.id}">
            <div class="ride-card-top">
              <div>
                <div class="ride-route-title">
                  <span>${Store.escapeHTML(r.from)}</span>
                  <span style="color:var(--brand-600);">→</span>
                  <span>${Store.escapeHTML(r.to)}</span>
                </div>
                ${stopsLine}
                <div class="ride-time-row">
                  📅 ${Store.formatDateBG(r.date)} · 🕒 ${Store.escapeHTML(r.time)} · 💺 ${r.seatsLeft}/${r.seatsTotal} места
                </div>
              </div>
              <div class="ride-price-box">
                <div class="ride-price-val">${Number(r.price).toFixed(0)} €</div>
                <div class="ride-price-unit">целият път</div>
              </div>
            </div>

            <div class="ride-badges">${badges}</div>

            <div class="ride-card-footer">
              <div class="driver-mini">
                <div class="avatar">${Store.getInitials(r.driverName)}</div>
                <div>
                  <div class="driver-name">
                    ${Store.escapeHTML(r.driverName)}
                    <span class="verified-dot" title="Верифициран">✓</span>
                  </div>
                  <div class="driver-sub">🚘 ${Store.escapeHTML(r.car)}</div>
                </div>
              </div>
              <button type="button" class="btn btn-outline btn-sm" data-open-ride="${r.id}">Резервирай</button>
            </div>
          </article>
        `;
      })
      .join('');

    listEl.querySelectorAll('.ride-card').forEach((card) => {
      card.addEventListener('click', (e) => {
        const rideId = Number(card.dataset.rideId);
        if (e.target.closest('[data-open-ride]')) {
          selectRide(rideId, false);
          openRideModal(rideId);
        } else {
          selectRide(rideId, false);
        }
      });
    });

    if (state.mapInstance) {
      state.mapInstance.renderRideMarkers(rides, state.selectedRideId);
      const activeRide = rides.find((r) => String(r.id) === String(state.selectedRideId));
      if (activeRide) updateMapRouteForRide(activeRide);
    }
  }

  function selectRide(rideId, scrollToCard) {
    state.selectedRideId = rideId;
    document.querySelectorAll('.ride-card').forEach((card) => {
      const match = String(card.dataset.rideId) === String(rideId);
      card.classList.toggle('selected', match);
      if (match && scrollToCard) {
        card.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });

    const rides = getFilteredRides();
    const ride = rides.find((r) => String(r.id) === String(rideId));
    if (state.mapInstance && ride) {
      state.mapInstance.renderRideMarkers(rides, rideId);
      updateMapRouteForRide(ride);
    }
  }

  async function updateMapRouteForRide(ride) {
    const hud = document.getElementById('map-route-hud');
    const titleEl = document.getElementById('hud-route-title');
    const metaEl = document.getElementById('hud-route-meta');

    hud.classList.remove('hidden');
    titleEl.textContent = `${ride.from} → ${ride.to} · ${Number(ride.price).toFixed(0)} €`;
    metaEl.textContent = 'Изчисляване на маршрута...';

    const info = await state.mapInstance.showRideRoute(ride);
    if (info) {
      const hrs = Math.floor(info.durationMin / 60);
      const mins = info.durationMin % 60;
      const durText = hrs > 0 ? `${hrs} ч. ${mins} мин` : `${mins} мин`;
      metaEl.textContent = `${info.distanceKm} км · около ${durText} · Тръгване ${ride.time}`;
    } else {
      metaEl.textContent = `Тръгване: ${Store.formatDateBG(ride.date)}, ${ride.time}`;
    }
  }

  /* ==================== RIDE DETAILS & SEGMENT BOOKING MODAL ==================== */
  function buildRoutePoints(ride) {
    const points = [{ label: ride.from, ratio: 0.0 }];
    (ride.stops || []).forEach((s) => {
      points.push({ label: s.name, ratio: typeof s.ratio === 'number' ? s.ratio : 0.5 });
    });
    points.push({ label: ride.to, ratio: 1.0 });
    points.sort((a, b) => a.ratio - b.ratio);
    return points;
  }

  function openRideModal(rideId) {
    const ride = Store.getRides().find((r) => String(r.id) === String(rideId));
    const user = Store.getCurrentUser();
    if (!ride || !user) return;

    const isMine = ride.driverId && String(ride.driverId) === String(user.id);
    const points = buildRoutePoints(ride);
    const pointOptions = points
      .map((p, idx) => `<option value="${idx}">${Store.escapeHTML(p.label)}</option>`)
      .join('');

    const seatOptions = Array.from({ length: Math.max(1, ride.seatsTotal) }, (_, i) => i + 1)
      .map((n) => `<option value="${n}">${n} ${n === 1 ? 'място' : 'места'}</option>`)
      .join('');

    const amenitiesHTML = (ride.amenities || [])
      .map((a) => `<span class="badge badge-green">${AMENITY_LABELS[a] || a}</span>`)
      .join('');

    const passengersHTML =
      ride.passengers && ride.passengers.length
        ? `<div style="margin-bottom:16px;">
            <div style="font-size:0.82rem; font-weight:700; color:var(--slate-700); margin-bottom:6px;">Текущи резервации по маршрута:</div>
            <ul style="padding-left:18px; font-size:0.84rem; color:var(--slate-600);">
              ${ride.passengers
                .map(
                  (p) =>
                    `<li><strong>${Store.escapeHTML(p.name)}</strong> — ${p.seats} м. (${Store.escapeHTML(p.segment_start_label)} → ${Store.escapeHTML(p.segment_end_label)}, ${Number(p.segment_price).toFixed(2)} €)</li>`
                )
                .join('')}
            </ul>
          </div>`
        : '';

    document.getElementById('modal-ride-title').textContent = `${ride.from} → ${ride.to}`;
    document.getElementById('modal-ride-body').innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:14px; background:var(--slate-50); border-radius:14px; margin-bottom:16px;">
        <div>
          <div style="font-weight:700;">📅 ${Store.formatDateBG(ride.date)} в ${Store.escapeHTML(ride.time)}</div>
          <div style="font-size:0.86rem; color:var(--slate-600); margin-top:3px;">📍 ${Store.escapeHTML(ride.pickup || ride.from)}</div>
        </div>
        <div style="text-align:right;">
          <div style="font-size:1.5rem; font-weight:800; color:var(--brand-700);">${Number(ride.price).toFixed(2)} €</div>
          <div style="font-size:0.78rem; color:var(--slate-500);">Свободни: ${ride.seatsLeft} от ${ride.seatsTotal}</div>
        </div>
      </div>

      <div style="display:flex; align-items:center; gap:12px; margin-bottom:16px;">
        <div class="avatar" style="width:46px; height:46px;">${Store.getInitials(ride.driverName)}</div>
        <div>
          <div style="font-weight:700; display:flex; align-items:center; gap:6px;">
            ${Store.escapeHTML(ride.driverName)}
            <span class="verified-dot">✓</span>
          </div>
          <div style="font-size:0.85rem; color:var(--slate-500);">
            🚘 ${Store.escapeHTML(ride.car)}
          </div>
        </div>
      </div>

      ${amenitiesHTML ? `<div class="ride-badges" style="margin-bottom:14px;">${amenitiesHTML}</div>` : ''}
      ${ride.notes ? `<p style="font-size:0.9rem; color:var(--slate-600); background:#fff; border:1px solid var(--slate-200); padding:12px; border-radius:10px; margin-bottom:16px;">${Store.escapeHTML(ride.notes)}</p>` : ''}
      ${passengersHTML}

      ${
        isMine
          ? `<div class="badge badge-amber" style="padding:10px 14px; width:100%; justify-content:center;">Това е твое публикувано пътуване.</div>`
          : `
            <div style="background:var(--slate-50); border:1px solid var(--slate-200); border-radius:14px; padding:14px; margin-bottom:14px;">
              <div style="font-weight:700; font-size:0.9rem; margin-bottom:10px;">Избор на отсечка и места</div>
              <div class="form-row">
                <div class="form-group">
                  <label for="seg-start-select">Качване от</label>
                  <select id="seg-start-select" class="form-control">${pointOptions}</select>
                </div>
                <div class="form-group">
                  <label for="seg-end-select">Слизане на</label>
                  <select id="seg-end-select" class="form-control">${pointOptions}</select>
                </div>
              </div>
              <div class="form-row" style="align-items:center;">
                <div class="form-group" style="margin-bottom:0;">
                  <label for="book-seats-select">Брой места</label>
                  <select id="book-seats-select" class="form-control">${seatOptions}</select>
                </div>
                <div style="text-align:right; padding-top:16px;">
                  <div style="font-size:0.78rem; color:var(--slate-500);">Цена за отсечката</div>
                  <div id="seg-price-preview" style="font-size:1.3rem; font-weight:800; color:var(--brand-700);"></div>
                </div>
              </div>
            </div>

            <div style="display:flex; gap:10px; flex-wrap:wrap;">
              <button type="button" class="btn btn-primary btn-lg" style="flex:1;" id="confirm-booking-btn">Потвърди резервация</button>
              <button type="button" class="btn btn-outline btn-lg" id="message-driver-btn">💬 Пиши на шофьора</button>
            </div>
          `
      }
    `;

    const startSel = document.getElementById('seg-start-select');
    const endSel = document.getElementById('seg-end-select');
    const seatsSel = document.getElementById('book-seats-select');
    const pricePreview = document.getElementById('seg-price-preview');

    function recalcSegmentPreview() {
      if (!startSel || !endSel || !seatsSel || !pricePreview) return;
      const sIdx = Number(startSel.value);
      const eIdx = Number(endSel.value);
      const seats = Number(seatsSel.value);
      if (eIdx <= sIdx) {
        pricePreview.innerHTML = '<span style="color:var(--red-500); font-size:0.9rem;">Невалиден участък</span>';
        return;
      }
      const span = Math.max(0.05, points[eIdx].ratio - points[sIdx].ratio);
      const factor = span >= 0.97 ? 1.0 : Math.max(0.15, Number(span.toFixed(2)));
      const total = (ride.price * factor * seats).toFixed(2);
      pricePreview.textContent = `${total} €`;
    }

    if (endSel && points.length > 1) {
      endSel.selectedIndex = points.length - 1;
      recalcSegmentPreview();
      startSel.addEventListener('change', recalcSegmentPreview);
      endSel.addEventListener('change', recalcSegmentPreview);
      seatsSel.addEventListener('change', recalcSegmentPreview);
    }

    const bookBtn = document.getElementById('confirm-booking-btn');
    if (bookBtn) {
      bookBtn.addEventListener('click', async () => {
        const sIdx = Number(startSel.value);
        const eIdx = Number(endSel.value);
        const seats = Number(seatsSel.value);
        if (eIdx <= sIdx) {
          showToast('Точката на слизане трябва да е след точката на качване.', 'error');
          return;
        }
        bookBtn.disabled = true;
        const res = await Store.bookRide(ride.id, {
          seats_booked: seats,
          segment_start_label: points[sIdx].label,
          segment_end_label: points[eIdx].label,
          segment_start_ratio: points[sIdx].ratio,
          segment_end_ratio: points[eIdx].ratio
        });
        bookBtn.disabled = false;

        if (!res.ok) {
          showToast(res.error, 'error');
          return;
        }
        closeModal('ride-modal');
        showToast(res.message || 'Резервацията е потвърдена!', 'success');
        renderAll();
      });
    }

    const msgBtn = document.getElementById('message-driver-btn');
    if (msgBtn) {
      msgBtn.addEventListener('click', () => {
        const thread = Store.ensureThread(ride);
        closeModal('ride-modal');
        state.activeThreadId = thread.id;
        switchView('messages');
      });
    }

    document.getElementById('ride-modal').classList.remove('hidden');
  }

  /* ==================== PUBLISH RIDE ==================== */
  function openPublishModal() {
    const user = Store.getCurrentUser();
    const dateEl = document.getElementById('pub-date');
    dateEl.min = Store.getOffsetDate(0);
    if (!dateEl.value) dateEl.value = Store.getOffsetDate(1);
    if (user && user.car && !document.getElementById('pub-car').value) {
      document.getElementById('pub-car').value = user.car;
    }
    document.getElementById('publish-modal').classList.remove('hidden');
  }

  async function handlePublishSubmit(e) {
    e.preventDefault();
    const user = Store.getCurrentUser();
    if (!user) return;

    const fromCity = Store.resolveCity(document.getElementById('pub-from').value);
    const toCity = Store.resolveCity(document.getElementById('pub-to').value);
    const stopRaw = document.getElementById('pub-stop').value.trim();

    if (!fromCity || !toCity) {
      showToast('Избери валидни български градове от списъка.', 'error');
      return;
    }
    if (fromCity.name === toCity.name) {
      showToast('Началният и крайният град трябва да са различни.', 'error');
      return;
    }

    const stops = [];
    if (stopRaw) {
      const stopCity = Store.resolveCity(stopRaw);
      if (!stopCity) {
        showToast('Междинната спирка трябва да е валиден град от списъка.', 'error');
        return;
      }
      if (stopCity.name !== fromCity.name && stopCity.name !== toCity.name) {
        stops.push({
          name: stopCity.name,
          lat: stopCity.coords[1],
          lng: stopCity.coords[0],
          ratio: 0.5
        });
      }
    }

    const amenities = Array.from(document.querySelectorAll('input[name="pub-amenity"]:checked')).map(
      (cb) => cb.value
    );

    try {
      const created = await Store.addRide({
        driver_name: user.name,
        origin_name: fromCity.name,
        dest_name: toCity.name,
        origin_lat: fromCity.coords[1],
        origin_lng: fromCity.coords[0],
        dest_lat: toCity.coords[1],
        dest_lng: toCity.coords[0],
        stops,
        ride_date: document.getElementById('pub-date').value,
        ride_time: document.getElementById('pub-time').value,
        price_per_seat: Number(document.getElementById('pub-price').value),
        available_seats: Number(document.getElementById('pub-seats').value),
        car_model: document.getElementById('pub-car').value.trim(),
        pickup_point: document.getElementById('pub-pickup').value.trim(),
        amenities,
        notes: document.getElementById('pub-notes').value.trim()
      });

      e.target.reset();
      closeModal('publish-modal');
      if (created) state.selectedRideId = created.id;
      showToast(`Пътуването ${fromCity.name} → ${toCity.name} е публикувано!`, 'success');
      await switchView('explore');
      updateNavBadges();
    } catch (err) {
      showToast(err.message || 'Грешка при публикуване.', 'error');
    }
  }

  function closeModal(id) {
    document.getElementById(id).classList.add('hidden');
  }

  /* ==================== MY TRIPS ==================== */
  function renderTrips() {
    const user = Store.getCurrentUser();
    const container = document.getElementById('trips-container');
    if (!user || !container) return;

    if (state.tripsTab === 'booked') {
      const bookings = Store.myBookingsCache || [];

      if (bookings.length === 0) {
        container.innerHTML = `
          <div class="empty-state" style="grid-column:1/-1;">
            <p style="font-weight:700; color:var(--slate-800); margin-bottom:6px;">Още нямаш резервирани пътувания</p>
            <p style="font-size:0.88rem; margin-bottom:16px;">Разгледай свободните места на картата и запази своето място.</p>
            <button type="button" class="btn btn-primary btn-sm" id="go-explore-btn">Търси пътуване</button>
          </div>
        `;
        document.getElementById('go-explore-btn').addEventListener('click', () => switchView('explore'));
        return;
      }

      container.innerHTML = bookings
        .map(
          (b) => `
            <article class="card">
              <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
                <span class="badge badge-green">✓ Потвърдена резервация</span>
                <strong>${Number(b.segment_price).toFixed(2)} €</strong>
              </div>
              <h3 style="margin-bottom:4px;">${Store.escapeHTML(b.segment_start_label)} → ${Store.escapeHTML(b.segment_end_label)}</h3>
              <p style="font-size:0.84rem; color:var(--slate-500); margin-bottom:10px;">
                Маршрут: ${Store.escapeHTML(b.full_route)} · 💺 ${b.seats_booked} ${b.seats_booked === 1 ? 'място' : 'места'}
              </p>
              <p style="font-size:0.86rem; margin-bottom:16px;">
                Шофьор: <strong>${Store.escapeHTML(b.driver_name)}</strong>
              </p>
              <div style="display:flex; gap:8px;">
                <button type="button" class="btn btn-outline btn-sm" data-trip-chat="${b.ride_id}">💬 Чат</button>
                <button type="button" class="btn btn-danger btn-sm" data-cancel-booking="${b.id}">Отмени</button>
              </div>
            </article>
          `
        )
        .join('');

      container.querySelectorAll('[data-trip-chat]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const ride = Store.getRides().find((r) => String(r.id) === String(btn.dataset.tripChat));
          if (!ride) return;
          const thr = Store.ensureThread(ride);
          state.activeThreadId = thr.id;
          switchView('messages');
        });
      });

      container.querySelectorAll('[data-cancel-booking]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            await Store.cancelBooking(Number(btn.dataset.cancelBooking));
            showToast('Резервацията е отменена.');
            renderAll();
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      });
    } else {
      const published = Store.myRidesCache || [];
      if (published.length === 0) {
        container.innerHTML = `
          <div class="empty-state" style="grid-column:1/-1;">
            <p style="font-weight:700; color:var(--slate-800); margin-bottom:6px;">Нямаш публикувани пътувания</p>
            <p style="font-size:0.88rem; margin-bottom:16px;">Сподели свободните си места и спести от гориво.</p>
            <button type="button" class="btn btn-primary btn-sm" id="empty-pub-trips-btn">+ Предложи пътуване</button>
          </div>
        `;
        document.getElementById('empty-pub-trips-btn').addEventListener('click', openPublishModal);
        return;
      }

      container.innerHTML = published
        .map(
          (r) => `
          <article class="card">
            <div style="display:flex; justify-content:space-between; margin-bottom:10px;">
              <span class="badge badge-amber">Статус: ${Store.escapeHTML(r.status)}</span>
              <strong>${Number(r.price).toFixed(2)} € / маршрут</strong>
            </div>
            <h3 style="margin-bottom:4px;">${Store.escapeHTML(r.from)} → ${Store.escapeHTML(r.to)}</h3>
            <p style="font-size:0.86rem; color:var(--slate-500); margin-bottom:14px;">
              📅 ${Store.formatDateBG(r.date)} · 🕒 ${Store.escapeHTML(r.time)} · Свободни: ${r.seatsLeft}/${r.seatsTotal}
            </p>
            <div style="display:flex; gap:8px;">
              <button type="button" class="btn btn-outline btn-sm" data-show-on-map="${r.id}">Виж на картата</button>
              <button type="button" class="btn btn-danger btn-sm" data-delete-ride="${r.id}">Изтрий</button>
            </div>
          </article>
        `
        )
        .join('');

      container.querySelectorAll('[data-show-on-map]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          state.selectedRideId = Number(btn.dataset.showOnMap);
          await switchView('explore');
        });
      });

      container.querySelectorAll('[data-delete-ride]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            await Store.adminDeleteRide(Number(btn.dataset.deleteRide));
            showToast('Обявата е премахната.');
            renderAll();
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      });
    }
  }

  /* ==================== ADMIN PANEL ==================== */
  async function renderAdmin() {
    const user = Store.getCurrentUser();
    const container = document.getElementById('admin-rides-container');
    if (!user || user.role !== 'admin' || !container) return;

    try {
      const rides = await Store.fetchAdminRides();
      if (!rides.length) {
        container.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">Няма пътувания в базата данни.</div>`;
        return;
      }

      container.innerHTML = rides
        .map(
          (r) => `
          <article class="card">
            <div style="display:flex; justify-content:space-between; margin-bottom:8px;">
              <span class="badge ${r.status === 'cancelled' ? '' : 'badge-green'}">#${r.id} · ${Store.escapeHTML(r.status)}</span>
              <strong>${Number(r.price).toFixed(2)} €</strong>
            </div>
            <h3 style="margin-bottom:4px;">${Store.escapeHTML(r.from)} → ${Store.escapeHTML(r.to)}</h3>
            <p style="font-size:0.85rem; color:var(--slate-500); margin-bottom:14px;">
              Шофьор: <strong>${Store.escapeHTML(r.driverName)}</strong> · Места: ${r.seatsLeft}/${r.seatsTotal}
            </p>
            <div style="display:flex; gap:6px; flex-wrap:wrap;">
              <button type="button" class="btn btn-outline btn-sm" data-adm-status="open" data-adm-id="${r.id}">Отвори</button>
              <button type="button" class="btn btn-outline btn-sm" data-adm-status="cancelled" data-adm-id="${r.id}">Отмени</button>
              <button type="button" class="btn btn-danger btn-sm" data-adm-del="${r.id}">Изтрий</button>
            </div>
          </article>
        `
        )
        .join('');

      container.querySelectorAll('[data-adm-status]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            await Store.adminSetStatus(Number(btn.dataset.admId), btn.dataset.admStatus);
            showToast('Статусът е обновен.', 'success');
            await renderAdmin();
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      });

      container.querySelectorAll('[data-adm-del]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          try {
            await Store.adminDeleteRide(Number(btn.dataset.admDel));
            showToast('Пътуването е изтрито.');
            await renderAdmin();
          } catch (err) {
            showToast(err.message, 'error');
          }
        });
      });
    } catch (err) {
      container.innerHTML = `<div class="empty-state" style="grid-column:1/-1;">${Store.escapeHTML(err.message)}</div>`;
    }
  }

  /* ==================== MESSAGES ==================== */
  function renderMessages() {
    const user = Store.getCurrentUser();
    if (!user) return;
    const threads = Store.getThreads(user.id);
    const listEl = document.getElementById('chat-threads-list');
    const boxEl = document.getElementById('chat-messages-box');
    const headerEl = document.getElementById('chat-active-header');
    const formEl = document.getElementById('chat-form');

    if (threads.length === 0) {
      listEl.innerHTML = `<div style="padding:20px; font-size:0.88rem; color:var(--slate-500);">Нямаш активни разговори. Отвори пътуване и натисни „Пиши на шофьора“.</div>`;
      headerEl.innerHTML = '<span>Съобщения</span>';
      boxEl.innerHTML = `<div class="empty-state" style="margin:auto;">Все още нямаш разговори с шофьори.</div>`;
      formEl.classList.add('hidden');
      return;
    }

    if (!state.activeThreadId || !threads.some((t) => t.id === state.activeThreadId)) {
      state.activeThreadId = threads[0].id;
    }

    listEl.innerHTML = threads
      .map((t) => {
        const last = t.messages[t.messages.length - 1];
        return `
          <div class="chat-thread-item ${t.id === state.activeThreadId ? 'active' : ''}" data-thread-id="${t.id}">
            <div style="font-weight:700; font-size:0.92rem;">${Store.escapeHTML(t.driverName)}</div>
            <div style="font-size:0.8rem; color:var(--brand-700); font-weight:600;">${Store.escapeHTML(t.routeLabel)}</div>
            <div style="font-size:0.8rem; color:var(--slate-500); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; margin-top:3px;">
              ${Store.escapeHTML(last ? last.text : '')}
            </div>
          </div>
        `;
      })
      .join('');

    listEl.querySelectorAll('.chat-thread-item').forEach((item) => {
      item.addEventListener('click', () => {
        state.activeThreadId = item.dataset.threadId;
        renderMessages();
      });
    });

    const active = threads.find((t) => t.id === state.activeThreadId);
    headerEl.innerHTML = `
      <div>
        <div>${Store.escapeHTML(active.driverName)}</div>
        <div style="font-size:0.8rem; font-weight:500; color:var(--slate-500);">${Store.escapeHTML(active.routeLabel)} · ${Store.formatDateBG(active.date)}</div>
      </div>
      <span class="badge badge-green">Онлайн</span>
    `;

    boxEl.innerHTML = active.messages
      .map(
        (m) => `
        <div class="chat-bubble ${m.sender}">
          ${Store.escapeHTML(m.text)}
          <span class="chat-bubble-time">${Store.escapeHTML(m.time)}</span>
        </div>
      `
      )
      .join('');
    boxEl.scrollTop = boxEl.scrollHeight;
    formEl.classList.remove('hidden');
  }

  function handleChatSubmit(e) {
    e.preventDefault();
    const input = document.getElementById('chat-input');
    const text = input.value.trim();
    if (!text || !state.activeThreadId) return;

    const currentThreadId = state.activeThreadId;
    Store.addMessage(currentThreadId, 'me', text);
    input.value = '';
    renderMessages();

    setTimeout(() => {
      const replies = [
        'Супер, благодаря! Ще се видим на уговореното място 10 минути по-рано.',
        'Разбира се, няма никакъв проблем. Има достатъчно място и за багажа.',
        'Точно така, потвърждавам! Ако има промяна, пиши ми тук.'
      ];
      const reply = replies[Math.floor(Math.random() * replies.length)];
      Store.addMessage(currentThreadId, 'them', reply);
      if (state.activeView === 'messages') renderMessages();
    }, 1000);
  }

  /* ==================== PROFILE ==================== */
  function renderProfile() {
    const user = Store.getCurrentUser();
    if (!user) return;

    document.getElementById('profile-avatar-lg').textContent = Store.getInitials(user.name);
    document.getElementById('profile-display-name').textContent = user.name;
    document.getElementById('profile-display-username').textContent = `@${user.username}`;
    document.getElementById('profile-role-badge').textContent =
      user.role === 'admin' ? '🛡️ Администратор' : '✓ Верифициран профил';

    document.getElementById('prof-name').value = user.name || '';
    document.getElementById('prof-phone').value = user.phone || '';
    document.getElementById('prof-car').value = user.car || '';
    document.getElementById('prof-bio').value = user.bio || '';

    document.getElementById('stat-my-bookings').textContent = (Store.myBookingsCache || []).length;
    document.getElementById('stat-my-published').textContent = (Store.myRidesCache || []).length;
  }

  async function handleProfileSubmit(e) {
    e.preventDefault();
    try {
      const updated = await Store.updateUser({
        name: document.getElementById('prof-name').value.trim(),
        phone: document.getElementById('prof-phone').value.trim(),
        car: document.getElementById('prof-car').value.trim(),
        bio: document.getElementById('prof-bio').value.trim()
      });
      if (updated) {
        syncUserUI(updated);
        renderProfile();
        showToast('Профилът е обновен успешно!', 'success');
      }
    } catch (err) {
      showToast(err.message, 'error');
    }
  }

  /* ==================== TOASTS ==================== */
  function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);
    setTimeout(() => {
      el.remove();
    }, 3400);
  }
})();