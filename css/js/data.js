(function (window) {
  'use strict';

  const STORAGE_KEYS = {
    TOKEN: 'vozia_token_v1',
    USER: 'vozia_user_v1',
    MESSAGES: 'vozia_messages_v1'
  };

  // Координати [lng, lat] за MapLibre GL
  const BG_CITIES = {
    'София': [23.3219, 42.6977],
    'Варна': [27.9147, 43.2141],
    'Пловдив': [24.7453, 42.1354],
    'Бургас': [27.4626, 42.5048],
    'Русе': [25.9534, 43.8356],
    'Стара Загора': [25.6250, 42.4258],
    'Плевен': [24.6167, 43.4170],
    'Сливен': [26.3229, 42.6817],
    'Добрич': [27.8273, 43.5726],
    'Шумен': [26.9229, 43.2712],
    'Перник': [23.0378, 42.6052],
    'Хасково': [25.5556, 41.9344],
    'Ямбол': [26.5035, 42.4842],
    'Пазарджик': [24.3336, 42.1928],
    'Благоевград': [23.0943, 42.0209],
    'Велико Търново': [25.6172, 43.0757],
    'Враца': [23.5529, 43.2102],
    'Габрово': [25.3187, 42.8742],
    'Асеновград': [24.8776, 42.0080],
    'Видин': [22.8741, 43.9962],
    'Казанлък': [25.3930, 42.6209],
    'Кюстендил': [22.6939, 42.2869],
    'Кърджали': [25.3777, 41.6338],
    'Монтана': [23.2257, 43.4085],
    'Димитровград': [25.5934, 42.0567],
    'Търговище': [26.5722, 43.2462],
    'Ловеч': [24.7139, 43.1370],
    'Силистра': [27.2672, 44.1147],
    'Дупница': [23.1186, 42.2665],
    'Свищов': [25.3503, 43.6196],
    'Разград': [26.5241, 43.5337],
    'Горна Оряховица': [25.6915, 43.1249],
    'Смолян': [24.7011, 41.5774],
    'Петрич': [23.2070, 41.3982],
    'Сандански': [23.2742, 41.5662],
    'Самоков': [23.5567, 42.3370],
    'Севлиево': [25.0956, 43.0258],
    'Карлово': [24.8065, 42.6416],
    'Велинград': [23.9916, 42.0275],
    'Троян': [24.7158, 42.8856],
    'Банско': [23.4857, 41.8404],
    'Созопол': [27.6962, 42.4173],
    'Несебър': [27.7279, 42.6606],
    'Слънчев бряг': [27.7104, 42.6952],
    'Поморие': [27.6439, 42.5588],
    'Балчик': [28.1636, 43.4217],
    'Каварна': [28.3395, 43.4360]
  };

  function getOffsetDate(days) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }

  function formatDateBG(isoDate) {
    if (!isoDate) return '';
    const [y, m, d] = isoDate.split('-');
    const months = ['яну', 'фев', 'мар', 'апр', 'май', 'юни', 'юли', 'авг', 'сеп', 'окт', 'ное', 'дек'];
    const idx = parseInt(m, 10) - 1;
    return `${parseInt(d, 10)} ${months[idx] || m} ${y}`;
  }

  function escapeHTML(str) {
    return String(str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function getInitials(name) {
    const parts = String(name || 'V').trim().split(/\s+/);
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
    return parts[0].slice(0, 2).toUpperCase();
  }

  function resolveCity(name) {
    if (!name) return null;
    const clean = name.trim().toLowerCase();
    for (const city of Object.keys(BG_CITIES)) {
      if (city.toLowerCase() === clean) return { name: city, coords: BG_CITIES[city] };
    }
    for (const city of Object.keys(BG_CITIES)) {
      if (city.toLowerCase().includes(clean)) return { name: city, coords: BG_CITIES[city] };
    }
    return null;
  }

  function haversineKm(c1, c2) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const R = 6371;
    const dLat = toRad(c2[1] - c1[1]);
    const dLon = toRad(c2[0] - c1[0]);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(c1[1])) * Math.cos(toRad(c2[1])) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  }

  function mapBackendUser(u) {
    if (!u) return null;
    return {
      id: u.id,
      username: u.username,
      name: u.full_name || u.username,
      full_name: u.full_name || u.username,
      phone: u.phone || '',
      car: u.car || '',
      bio: u.bio || '',
      role: u.role || 'user',
      verified: true
    };
  }

  function mapBackendRide(r) {
    return {
      id: r.id,
      driverId: r.owner_user_id,
      driverName: r.driver_name,
      driverPhone: r.driver_phone || '+359 88 900 1122',
      verified: true,
      from: r.origin_name,
      to: r.dest_name,
      originLat: r.origin_lat,
      originLng: r.origin_lng,
      destLat: r.dest_lat,
      destLng: r.dest_lng,
      stops: Array.isArray(r.stops) ? r.stops : [],
      date: r.ride_date || getOffsetDate(0),
      time: r.ride_time || '09:00',
      price: Number(r.price_per_seat),
      seatsTotal: Number(r.total_seats),
      seatsLeft: Number(r.available_seats),
      car: r.car_model || 'Комфортен автомобил',
      pickup: r.pickup_point || r.origin_name,
      amenities: Array.isArray(r.amenities) ? r.amenities : ['ac', 'nosmoke'],
      notes: r.notes || '',
      status: r.status || 'open',
      passengers: Array.isArray(r.passengers) ? r.passengers : []
    };
  }

  const VoziaStore = {
    BG_CITIES,
    getOffsetDate,
    formatDateBG,
    escapeHTML,
    getInitials,
    resolveCity,
    haversineKm,

    ridesCache: [],
    myRidesCache: [],
    myBookingsCache: [],

    getToken() {
      return localStorage.getItem(STORAGE_KEYS.TOKEN) || null;
    },

    getCurrentUser() {
      if (!this.getToken()) return null;
      return readJSON(STORAGE_KEYS.USER, null);
    },

    _setSession(token, backendUser) {
      localStorage.setItem(STORAGE_KEYS.TOKEN, token);
      const mapped = mapBackendUser(backendUser);
      writeJSON(STORAGE_KEYS.USER, mapped);
      return mapped;
    },

    logout() {
      localStorage.removeItem(STORAGE_KEYS.TOKEN);
      localStorage.removeItem(STORAGE_KEYS.USER);
      this.myRidesCache = [];
      this.myBookingsCache = [];
    },

    async _api(path, options = {}) {
      const headers = { 'Content-Type': 'application/json', ...(options.headers || {}) };
      const token = this.getToken();
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const res = await fetch(path, { ...options, headers });
      let data = null;
      try {
        data = await res.json();
      } catch (_) {}

      if (!res.ok) {
        const msg =
          (data && (typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail))) ||
          `Грешка (${res.status})`;
        const err = new Error(msg);
        err.status = res.status;
        throw err;
      }
      return data;
    },

    async login(username, password) {
      try {
        const data = await this._api('/api/auth/login', {
          method: 'POST',
          body: JSON.stringify({ username: username.trim(), password })
        });
        const user = this._setSession(data.token, data.user);
        return { ok: true, user };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    async loginDemo() {
      return this.login('demo', 'demo123');
    },

    async loginAdmin() {
      return this.login('admin', 'admin123');
    },

    async register({ name, username, phone, password, car }) {
      try {
        const data = await this._api('/api/auth/register', {
          method: 'POST',
          body: JSON.stringify({
            username: username.trim(),
            full_name: name.trim(),
            phone: (phone || '').trim(),
            car: (car || '').trim(),
            password
          })
        });
        const user = this._setSession(data.token, data.user);
        return { ok: true, user };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    async syncProfile() {
      if (!this.getToken()) return null;
      try {
        const data = await this._api('/api/profile');
        const user = mapBackendUser(data.user);
        writeJSON(STORAGE_KEYS.USER, user);
        this.myRidesCache = (data.rides || []).map(mapBackendRide);
        this.myBookingsCache = data.bookings || [];
        return user;
      } catch (err) {
        if (err.status === 401) {
          this.logout();
        }
        return null;
      }
    },

    async updateUser(updates) {
      try {
        const data = await this._api('/api/profile', {
          method: 'PUT',
          body: JSON.stringify({
            full_name: updates.name,
            phone: updates.phone || '',
            car: updates.car || '',
            bio: updates.bio || ''
          })
        });
        const user = mapBackendUser(data.user);
        writeJSON(STORAGE_KEYS.USER, user);
        return user;
      } catch (err) {
        throw err;
      }
    },

    async fetchRides() {
      const list = await this._api('/api/rides');
      this.ridesCache = (list || []).map(mapBackendRide);
      return this.ridesCache;
    },

    getRides() {
      return this.ridesCache;
    },

    async addRide(payload) {
      const data = await this._api('/api/rides', {
        method: 'POST',
        body: JSON.stringify(payload)
      });
      await this.fetchRides();
      await this.syncProfile();
      return data.ride ? mapBackendRide(data.ride) : null;
    },

    async bookRide(rideId, bookingPayload) {
      try {
        const data = await this._api(`/api/rides/${rideId}/book`, {
          method: 'POST',
          body: JSON.stringify(bookingPayload)
        });
        await this.fetchRides();
        await this.syncProfile();
        return { ok: true, message: data.message };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    },

    async cancelBooking(bookingId) {
      const data = await this._api(`/api/bookings/${bookingId}`, {
        method: 'DELETE'
      });
      await this.fetchRides();
      await this.syncProfile();
      return data;
    },

    async fetchAdminRides() {
      const list = await this._api('/api/admin/rides');
      return (list || []).map(mapBackendRide);
    },

    async adminSetStatus(rideId, status) {
      await this._api(`/api/admin/rides/${rideId}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status })
      });
      await this.fetchRides();
      await this.syncProfile();
    },

    async adminDeleteRide(rideId) {
      await this._api(`/api/admin/rides/${rideId}`, {
        method: 'DELETE'
      });
      await this.fetchRides();
      await this.syncProfile();
    },

    // Чат нишки в localStorage за съответния потребител
    getThreads(userId) {
      return readJSON(STORAGE_KEYS.MESSAGES, []).filter((t) => t.userId === userId);
    },

    ensureThread(ride) {
      const user = this.getCurrentUser();
      if (!user) return null;
      const all = readJSON(STORAGE_KEYS.MESSAGES, []);
      let thread = all.find((t) => t.userId === user.id && String(t.rideId) === String(ride.id));
      if (!thread) {
        thread = {
          id: 'thr_' + Date.now(),
          userId: user.id,
          rideId: ride.id,
          driverName: ride.driverName,
          routeLabel: `${ride.from} → ${ride.to}`,
          date: ride.date,
          messages: [
            {
              sender: 'them',
              text: `Здравей! Аз съм ${ride.driverName}. Ако имаш въпроси за пътуването ${ride.from} – ${ride.to}, пиши ми тук.`,
              time: new Date().toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' })
            }
          ]
        };
        all.unshift(thread);
        writeJSON(STORAGE_KEYS.MESSAGES, all);
      }
      return thread;
    },

    addMessage(threadId, sender, text) {
      const all = readJSON(STORAGE_KEYS.MESSAGES, []);
      const thread = all.find((t) => t.id === threadId);
      if (!thread) return null;
      thread.messages.push({
        sender,
        text,
        time: new Date().toLocaleTimeString('bg-BG', { hour: '2-digit', minute: '2-digit' })
      });
      writeJSON(STORAGE_KEYS.MESSAGES, all);
      return thread;
    }
  };

  window.VoziaStore = VoziaStore;
})(window);