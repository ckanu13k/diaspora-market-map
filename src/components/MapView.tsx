import { useEffect, useRef } from 'react';
import { Map as MLMap, Marker, NavigationControl, setWorkerUrl, type GeoJSONSource, type LngLatBoundsLike, type MapLayerMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre v6 loads its worker relative to its own module URL, which bundling breaks — point it at the emitted file.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

setWorkerUrl(workerUrl);
import type { Place } from '../lib/types';

const STYLE = 'https://tiles.openfreemap.org/styles/positron'; // quiet grey basemap so the pins carry the color
const US_BOUNDS: LngLatBoundsLike = [[-125, 24], [-66.5, 49.5]];

export interface Bounds { west: number; south: number; east: number; north: number }

interface Props {
  places: Place[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  onBounds: (b: Bounds) => void;
  flyTo: { lng: number; lat: number; zoom?: number; seq: number; instant?: boolean } | null;
  userLoc?: { lat: number; lng: number } | null;
}

function toGeoJSON(places: Place[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: places.map((p) => ({
      type: 'Feature',
      id: p.id,
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: {
        id: p.id,
        kind: p.kind,
        verified: p.verification === 'verified' ? 2 : p.verification === 'community' ? 1 : 0,
        closed: p.status !== 'active' ? 1 : 0,
        featured: p.featured ? 1 : 0,
      },
    })),
  };
}

export default function MapView({ places, selectedId, onSelect, onBounds, flyTo, userLoc }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<MLMap | null>(null);
  const ready = useRef(false);
  const latest = useRef({ places, onSelect, onBounds });
  latest.current = { places, onSelect, onBounds };

  useEffect(() => {
    if (!el.current) return;
    const m = new MLMap({ container: el.current, style: STYLE, bounds: US_BOUNDS, fitBoundsOptions: { padding: 20 }, attributionControl: { compact: true } });
    map.current = m;
    m.addControl(new NavigationControl({ showCompass: false }), 'bottom-right');

    const emitBounds = () => {
      const b = m.getBounds();
      latest.current.onBounds({ west: b.getWest(), south: b.getSouth(), east: b.getEast(), north: b.getNorth() });
    };

    m.on('load', () => {
      m.addSource('places', { type: 'geojson', data: toGeoJSON(latest.current.places), cluster: true, clusterRadius: 48, clusterMaxZoom: 12, promoteId: 'id' });

      m.addLayer({ id: 'clusters', type: 'circle', source: 'places', filter: ['has', 'point_count'],
        paint: {
          'circle-color': ['step', ['get', 'point_count'], '#5866B4', 25, '#3A4793', 150, '#26316B'],
          'circle-radius': ['step', ['get', 'point_count'], 15, 25, 20, 150, 26],
          'circle-stroke-width': 4, 'circle-stroke-color': 'rgba(255,255,255,.9)',
        } });
      m.addLayer({ id: 'cluster-count', type: 'symbol', source: 'places', filter: ['has', 'point_count'],
        layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 13, 'text-font': ['Noto Sans Bold'] },
        paint: { 'text-color': '#fff' } });
      m.addLayer({ id: 'points', type: 'circle', source: 'places', filter: ['!', ['has', 'point_count']],
        paint: {
          'circle-color': ['case', ['==', ['get', 'closed'], 1], '#A3A8B6', ['==', ['get', 'kind'], 'market'], '#D69A1D', '#A8294F'],
          'circle-radius': ['case', ['boolean', ['feature-state', 'selected'], false], 10, ['==', ['get', 'featured'], 1], 8, 6.5],
          'circle-stroke-width': ['case', ['boolean', ['feature-state', 'selected'], false], 4, ['>=', ['get', 'verified'], 1], 3, 2],
          'circle-stroke-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#141B3D', ['==', ['get', 'verified'], 2], '#26316B', ['==', ['get', 'verified'], 1], '#7A86CC', '#ffffff'],
        } });

      m.on('click', 'clusters', async (e: MapLayerMouseEvent) => {
        const f = m.queryRenderedFeatures(e.point, { layers: ['clusters'] })[0];
        const zoom = await (m.getSource('places') as GeoJSONSource).getClusterExpansionZoom(f.properties.cluster_id);
        m.easeTo({ center: (f.geometry as GeoJSON.Point).coordinates as [number, number], zoom });
      });
      m.on('click', 'points', (e: MapLayerMouseEvent) => {
        const id = e.features?.[0]?.properties?.id;
        if (id) latest.current.onSelect(id);
      });
      for (const layer of ['clusters', 'points']) {
        m.on('mouseenter', layer, () => (m.getCanvas().style.cursor = 'pointer'));
        m.on('mouseleave', layer, () => (m.getCanvas().style.cursor = ''));
      }
      ready.current = true;
      emitBounds();
    });
    m.on('moveend', emitBounds);
    return () => { ready.current = false; m.remove(); };
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    (m.getSource('places') as GeoJSONSource | undefined)?.setData(toGeoJSON(places));
  }, [places]);

  const prevSelected = useRef<string | null>(null);
  useEffect(() => {
    const m = map.current;
    if (!m || !ready.current) return;
    if (prevSelected.current) m.setFeatureState({ source: 'places', id: prevSelected.current }, { selected: false });
    if (selectedId) m.setFeatureState({ source: 'places', id: selectedId }, { selected: true });
    prevSelected.current = selectedId;
  }, [selectedId, places]);

  useEffect(() => {
    if (!flyTo || !map.current) return;
    const opts = { center: [flyTo.lng, flyTo.lat] as [number, number], zoom: flyTo.zoom ?? 14 };
    if (flyTo.instant || window.matchMedia('(prefers-reduced-motion: reduce)').matches) map.current.jumpTo(opts);
    else map.current.flyTo({ ...opts, essential: true });
  }, [flyTo]);

  // "You are here" dot
  const youMarker = useRef<Marker | null>(null);
  useEffect(() => {
    const m = map.current;
    if (!m) return;
    youMarker.current?.remove();
    youMarker.current = null;
    if (userLoc) {
      const dot = document.createElement('div');
      dot.className = 'you-dot';
      dot.setAttribute('aria-label', 'Your location');
      youMarker.current = new Marker({ element: dot }).setLngLat([userLoc.lng, userLoc.lat]).addTo(m);
    }
  }, [userLoc]);

  return <div ref={el} className="map" role="application" aria-label="Map of markets and restaurants" />;
}
