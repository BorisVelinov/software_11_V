(function (window) {
  'use strict';

  const STYLES = {
    vector: 'https://tiles.openfreemap.org/styles/liberty',
    'esri-street': {
      version: 8,
      sources: {
        esriStreet: {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}'
          ],
          tileSize: 256,
          attribution: '© Esri World Street Map'
        }
      },
      layers: [{ id: 'esri-street-layer', type: 'raster', source: 'esriStreet' }]
    },
    'esri-sat': {
      version: 8,
      sources: {
        esriSat: {
          type: 'raster',
          tiles: [
            'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
          ],
          tileSize: 256,
          attribution: '© Esri World Imagery'
        }
      },
      layers: [{ id: 'esri-sat-layer', type: 'raster', source: 'esriSat' }]
    }
  };

  class VoziaMap {
    constructor(containerId, onSelectRide) {
      this.containerId = containerId;
      this.onSelectRide = onSelectRide;
      this.map = null;
      this.currentStyleKey = 'vector';
      this.fallbackTriggered = false;
      this.styleLoaded = false;
      this.rideMarkers = [];
      this.endpointMarkers = [];
      this.currentRouteGeoJSON = null;
      this.resizeObserver = null;
    }

    init() {
      const container = document.getElementById(this.containerId);
      if (!container) return false;

      if (typeof window.maplibregl === 'undefined') {
        container.innerHTML =
          '<div style="display:grid;place-items:center;height:100%;padding:24px;text-align:center;color:#475569;">Библиотеката MapLibre не успя да се зареди. Провери връзката и презареди страницата.</div>';
        return false;
      }

      if (this.map) {
        this.map.resize();
        return true;
      }

      try {
        this.map = new window.maplibregl.Map({
          container: this.containerId,
          style: STYLES.vector,
          center: [25.4858, 42.7339],
          zoom: 6.4,
          attributionControl: true
        });
      } catch (_) {
        container.innerHTML =
          '<div style="display:grid;place-items:center;height:100%;padding:24px;text-align:center;color:#475569;">Браузърът не поддържа WebGL за интерактивната карта.</div>';
        return false;
      }

      this.map.addControl(new window.maplibregl.NavigationControl(), 'top-right');

      // Автоматично превключване към Esri, ако векторната карта е блокирана
      const fallbackTimer = setTimeout(() => {
        if (!this.styleLoaded && !this.fallbackTriggered) {
          this._triggerEsriFallback();
        }
      }, 6000);

      this.map.on('style.load', () => {
        this.styleLoaded = true;
        clearTimeout(fallbackTimer);
        if (this.currentRouteGeoJSON) {
          this._drawRouteLayer(this.currentRouteGeoJSON);
        }
      });

      this.map.on('error', (e) => {
        const msg = String(e?.error?.message || '');
        const status = e?.error?.status || 0;
        if (
          !this.styleLoaded &&
          !this.fallbackTriggered &&
          (status >= 400 || msg.includes('openfreemap') || msg.includes('Failed to fetch'))
        ) {
          clearTimeout(fallbackTimer);
          this._triggerEsriFallback();
        }
      });

      if (typeof ResizeObserver !== 'undefined') {
        this.resizeObserver = new ResizeObserver(() => {
          if (this.map) this.map.resize();
        });
        this.resizeObserver.observe(container);
      }

      return true;
    }

    _triggerEsriFallback() {
      this.fallbackTriggered = true;
      this.setStyle('esri-street');
      document.querySelectorAll('.map-style-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.mapStyle === 'esri-street');
      });
    }

    setStyle(styleKey) {
      if (!this.map || !STYLES[styleKey]) return;
      if (this.currentStyleKey === styleKey && this.styleLoaded) return;
      this.currentStyleKey = styleKey;
      this.styleLoaded = false;
      this.map.setStyle(STYLES[styleKey]);
    }

    resize() {
      if (this.map) this.map.resize();
    }

    _getRideStartCoords(ride) {
      if (typeof ride.originLng === 'number' && typeof ride.originLat === 'number') {
        return [ride.originLng, ride.originLat];
      }
      const c = window.VoziaStore.resolveCity(ride.from);
      return c ? c.coords : null;
    }

    _getRideEndCoords(ride) {
      if (typeof ride.destLng === 'number' && typeof ride.destLat === 'number') {
        return [ride.destLng, ride.destLat];
      }
      const c = window.VoziaStore.resolveCity(ride.to);
      return c ? c.coords : null;
    }

    renderRideMarkers(rides, selectedRideId) {
      if (!this.map) return;

      this.rideMarkers.forEach((m) => m.remove());
      this.rideMarkers = [];

      const offsets = {};

      rides.forEach((ride) => {
        const coords = this._getRideStartCoords(ride);
        if (!coords) return;

        const key = ride.from;
        const count = offsets[key] || 0;
        offsets[key] = count + 1;

        const angle = count * 1.4;
        const radius = count === 0 ? 0 : 0.045;
        const lng = coords[0] + Math.cos(angle) * radius;
        const lat = coords[1] + Math.sin(angle) * radius;

        const el = document.createElement('button');
        el.type = 'button';
        el.className = 'vozia-price-marker' + (String(ride.id) === String(selectedRideId) ? ' active' : '');
        el.textContent = `${Number(ride.price).toFixed(0)} €`;
        el.title = `${ride.from} → ${ride.to} (${ride.time})`;
        el.addEventListener('click', (ev) => {
          ev.stopPropagation();
          if (this.onSelectRide) this.onSelectRide(ride.id);
        });

        const marker = new window.maplibregl.Marker({ element: el })
          .setLngLat([lng, lat])
          .addTo(this.map);

        this.rideMarkers.push(marker);
      });
    }

    async showRideRoute(ride) {
      if (!this.map || !ride) return null;

      const startCoords = this._getRideStartCoords(ride);
      const endCoords = this._getRideEndCoords(ride);
      if (!startCoords || !endCoords) return null;

      this.endpointMarkers.forEach((m) => m.remove());
      this.endpointMarkers = [];

      const pinA = document.createElement('div');
      pinA.className = 'vozia-endpoint-pin start';
      pinA.textContent = 'A';
      const pinB = document.createElement('div');
      pinB.className = 'vozia-endpoint-pin end';
      pinB.textContent = 'B';

      this.endpointMarkers.push(
        new window.maplibregl.Marker({ element: pinA }).setLngLat(startCoords).addTo(this.map),
        new window.maplibregl.Marker({ element: pinB }).setLngLat(endCoords).addTo(this.map)
      );

      const waypoints = [startCoords];
      (ride.stops || []).forEach((s) => {
        if (typeof s.lng === 'number' && typeof s.lat === 'number') {
          waypoints.push([s.lng, s.lat]);
          const pinStop = document.createElement('div');
          pinStop.className = 'vozia-endpoint-pin';
          pinStop.style.background = '#f59e0b';
          pinStop.style.width = '22px';
          pinStop.style.height = '22px';
          pinStop.style.fontSize = '0.7rem';
          pinStop.textContent = '•';
          pinStop.title = `Спирка: ${s.name}`;
          this.endpointMarkers.push(
            new window.maplibregl.Marker({ element: pinStop }).setLngLat([s.lng, s.lat]).addTo(this.map)
          );
        }
      });
      waypoints.push(endCoords);

      let routeGeo = null;
      let distanceKm = Math.round(window.VoziaStore.haversineKm(startCoords, endCoords) * 1.22);
      let durationMin = Math.round((distanceKm / 84) * 60);

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 4500);
        const coordString = waypoints.map((p) => `${p[0]},${p[1]}`).join(';');
        const url = `https://router.project-osrm.org/route/v1/driving/${coordString}?overview=full&geometries=geojson`;
        const resp = await fetch(url, { signal: controller.signal });
        clearTimeout(timer);

        if (resp.ok) {
          const data = await resp.json();
          if (data.routes && data.routes[0] && data.routes[0].geometry) {
            routeGeo = {
              type: 'Feature',
              geometry: data.routes[0].geometry
            };
            distanceKm = Math.round(data.routes[0].distance / 1000);
            durationMin = Math.round(data.routes[0].duration / 60);
          }
        }
      } catch (_) {}

      if (!routeGeo) {
        routeGeo = this._buildMultiPointLine(waypoints);
      }

      this.currentRouteGeoJSON = routeGeo;
      if (this.map.isStyleLoaded()) {
        this._drawRouteLayer(routeGeo);
      }

      const bounds = new window.maplibregl.LngLatBounds();
      waypoints.forEach((pt) => bounds.extend(pt));
      const coords = routeGeo.geometry.coordinates;
      for (let i = 0; i < coords.length; i += Math.max(1, Math.floor(coords.length / 20))) {
        bounds.extend(coords[i]);
      }

      this.map.fitBounds(bounds, {
        padding: { top: 75, bottom: 110, left: 60, right: 60 },
        maxZoom: 11,
        duration: 750
      });

      return { distanceKm, durationMin };
    }

    clearRoute() {
      this.currentRouteGeoJSON = null;
      this.endpointMarkers.forEach((m) => m.remove());
      this.endpointMarkers = [];
      if (!this.map || !this.map.isStyleLoaded()) return;
      if (this.map.getLayer('vozia-route-line')) this.map.removeLayer('vozia-route-line');
      if (this.map.getLayer('vozia-route-outline')) this.map.removeLayer('vozia-route-outline');
      if (this.map.getSource('vozia-route')) this.map.removeSource('vozia-route');
    }

    _drawRouteLayer(featureGeoJSON) {
      if (!this.map) return;
      try {
        if (this.map.getSource('vozia-route')) {
          this.map.getSource('vozia-route').setData(featureGeoJSON);
          return;
        }
        this.map.addSource('vozia-route', {
          type: 'geojson',
          data: featureGeoJSON
        });
        this.map.addLayer({
          id: 'vozia-route-outline',
          type: 'line',
          source: 'vozia-route',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#ffffff', 'line-width': 8, 'line-opacity': 0.9 }
        });
        this.map.addLayer({
          id: 'vozia-route-line',
          type: 'line',
          source: 'vozia-route',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#059669', 'line-width': 4.5 }
        });
      } catch (_) {}
    }

    _buildMultiPointLine(waypoints) {
      const allPoints = [];
      for (let w = 0; w < waypoints.length - 1; w++) {
        const start = waypoints[w];
        const end = waypoints[w + 1];
        const midLng = (start[0] + end[0]) / 2;
        const midLat = (start[1] + end[1]) / 2 + 0.12;
        const steps = 20;
        for (let i = 0; i <= steps; i++) {
          const t = i / steps;
          const lng = (1 - t) * (1 - t) * start[0] + 2 * (1 - t) * t * midLng + t * t * end[0];
          const lat = (1 - t) * (1 - t) * start[1] + 2 * (1 - t) * t * midLat + t * t * end[1];
          allPoints.push([lng, lat]);
        }
      }
      return {
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: allPoints }
      };
    }
  }

  window.VoziaMap = VoziaMap;
})(window);