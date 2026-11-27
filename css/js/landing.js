(function () {
  'use strict';

  const Store = window.VoziaStore;

  document.addEventListener('DOMContentLoaded', () => {
    populateCityDatalist();
    updateNavForSession();
    initMobileMenu();
    initHeroSearch();
    renderPopularRoutes();
    initCalculator();
    initFAQ();
  });

  function populateCityDatalist() {
    const list = document.getElementById('bg-cities-datalist');
    if (!list) return;
    list.innerHTML = Object.keys(Store.BG_CITIES)
      .map((city) => `<option value="${Store.escapeHTML(city)}"></option>`)
      .join('');
  }

  function updateNavForSession() {
    const user = Store.getCurrentUser();
    const container = document.getElementById('landing-nav-actions');
    if (!user || !container) return;

    container.innerHTML = `
      <a href="app.html" class="btn btn-primary">Отвори приложението (${Store.escapeHTML(user.name.split(' ')[0])})</a>
    `;
  }

  function initMobileMenu() {
    const btn = document.getElementById('mobile-menu-btn');
    const header = document.getElementById('site-header');
    if (!btn || !header) return;
    btn.addEventListener('click', () => {
      header.classList.toggle('menu-open');
    });
  }

  function initHeroSearch() {
    const dateInput = document.getElementById('home-date');
    if (dateInput) {
      dateInput.min = Store.getOffsetDate(0);
    }

    const form = document.getElementById('hero-search-form');
    if (!form) return;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const params = new URLSearchParams();
      const from = document.getElementById('home-from').value.trim();
      const to = document.getElementById('home-to').value.trim();
      const date = document.getElementById('home-date').value;
      const seats = document.getElementById('home-seats').value;

      if (from) params.set('from', from);
      if (to) params.set('to', to);
      if (date) params.set('date', date);
      if (seats && seats !== '1') params.set('seats', seats);

      const query = params.toString();
      window.location.href = query ? `app.html?${query}` : 'app.html';
    });
  }

  function renderPopularRoutes() {
    const grid = document.getElementById('popular-routes-grid');
    if (!grid) return;

    const popular = [
      { from: 'София', to: 'Варна', duration: '~5 ч. 15 мин', price: 21 },
      { from: 'София', to: 'Пловдив', duration: '~1 ч. 40 мин', price: 9 },
      { from: 'София', to: 'Бургас', duration: '~3 ч. 45 мин', price: 19 },
      { from: 'Варна', to: 'Бургас', duration: '~2 ч. 00 мин', price: 10 },
      { from: 'Пловдив', to: 'Бургас', duration: '~2 ч. 30 мин', price: 14 },
      { from: 'София', to: 'Велико Търново', duration: '~2 ч. 45 мин', price: 13 }
    ];

    grid.innerHTML = popular
      .map(
        (r) => `
      <a class="route-card" href="app.html?from=${encodeURIComponent(r.from)}&to=${encodeURIComponent(r.to)}">
        <div class="route-cities">
          <span>${Store.escapeHTML(r.from)}</span>
          <span class="route-arrow">→</span>
          <span>${Store.escapeHTML(r.to)}</span>
        </div>
        <div class="route-meta">
          <span>Време: ${r.duration}</span>
          <span class="route-price">от ${r.price} €</span>
        </div>
      </a>
    `
      )
      .join('');
  }

  function initCalculator() {
    const routeSel = document.getElementById('calc-route');
    const seatsRange = document.getElementById('calc-seats');
    const tripsRange = document.getElementById('calc-trips');
    const seatsLabel = document.getElementById('calc-seats-label');
    const tripsLabel = document.getElementById('calc-trips-label');
    const output = document.getElementById('calc-output');
    const subtext = document.getElementById('calc-subtext');

    if (!routeSel || !seatsRange || !tripsRange) return;

    function recalc() {
      const [, pricePerSeat] = routeSel.value.split('|').map(Number);
      const seats = Number(seatsRange.value);
      const trips = Number(tripsRange.value);
      const perTrip = pricePerSeat * seats;
      const monthly = perTrip * trips;

      seatsLabel.textContent = seats === 1 ? '1 място' : `${seats} места`;
      tripsLabel.textContent = trips === 1 ? '1 пътуване' : `${trips} пътувания`;
      output.textContent = `${monthly} €`;
      subtext.textContent = `Около ${perTrip} € на пътуване при ${seats} ${seats === 1 ? 'пътник' : 'пътници'}`;
    }

    routeSel.addEventListener('change', recalc);
    seatsRange.addEventListener('input', recalc);
    tripsRange.addEventListener('input', recalc);
    recalc();
  }

  function initFAQ() {
    document.querySelectorAll('.faq-question').forEach((btn) => {
      btn.addEventListener('click', () => {
        const item = btn.closest('.faq-item');
        item.classList.toggle('open');
      });
    });
  }
})();