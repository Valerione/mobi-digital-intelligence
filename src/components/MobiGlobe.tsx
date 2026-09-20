'use client';

import { useEffect, useRef } from 'react';
import { Map as MapLibreMap, Popup, setWorkerUrl, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import type { IntelligenceSnapshot } from '@/lib/mobi-intelligence';

const CITIES = [
  ['ROME // MOBI.DIGITAL', 12.4964, 41.9028, 2],
  ['LONDON', -0.1276, 51.5072, 1],
  ['NEW YORK', -74.006, 40.7128, 1],
  ['DUBAI', 55.2708, 25.2048, 1],
  ['SINGAPORE', 103.8198, 1.3521, 1],
  ['TOKYO', 139.6917, 35.6895, 1],
  ['HONG KONG', 114.1694, 22.3193, 1],
] as const;

const BASEMAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    countries: {
      type: 'geojson',
      data: '/data/world-countries.geojson',
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#030b11' } },
    {
      id: 'countries-fill', type: 'fill', source: 'countries',
      paint: { 'fill-color': '#0a1a22', 'fill-opacity': 0.92 },
    },
    {
      id: 'countries-outline', type: 'line', source: 'countries',
      paint: { 'line-color': '#1b5262', 'line-width': 0.65, 'line-opacity': 0.72 },
    },
  ],
};

function featureCollection(features: GeoJSON.Feature[]): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features };
}

function cityData(): GeoJSON.FeatureCollection {
  return featureCollection(CITIES.map(([name, longitude, latitude, home]) => ({
    type: 'Feature',
    properties: { name, home },
    geometry: { type: 'Point', coordinates: [longitude, latitude] },
  })));
}

function flowData(): GeoJSON.FeatureCollection {
  const rome: [number, number] = [12.4964, 41.9028];
  return featureCollection(CITIES.slice(1, 5).map(([, longitude, latitude]) => ({
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: [rome, [longitude, latitude]] },
  })));
}

function flowPulseData(timestamp: number): GeoJSON.FeatureCollection {
  const rome: [number, number] = [12.4964, 41.9028];
  return featureCollection(CITIES.slice(1, 5).map(([, longitude, latitude], index) => {
    const progress = ((timestamp / 6_000) + index * 0.23) % 1;
    return {
      type: 'Feature',
      properties: { index },
      geometry: {
        type: 'Point',
        coordinates: [
          rome[0] + (longitude - rome[0]) * progress,
          rome[1] + (latitude - rome[1]) * progress,
        ],
      },
    };
  }));
}

export default function MobiGlobe({ data }: { data: IntelligenceSnapshot | null }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const loadedRef = useRef(false);
  const dataRef = useRef(data);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    setWorkerUrl(new URL('/maplibre-gl-worker.mjs', window.location.origin).href);
    const map = new MapLibreMap({
      container: containerRef.current,
      style: {
        ...BASEMAP_STYLE,
        sources: {
          countries: {
            type: 'geojson',
            data: new URL('/data/world-countries.geojson', window.location.origin).href,
          },
        },
      },
      center: [12.4964, 23],
      zoom: 1.35,
      minZoom: 0.8,
      maxZoom: 8,
      attributionControl: false,
      renderWorldCopies: false,
    });
    mapRef.current = map;

    const syncData = () => {
      const snapshot = dataRef.current;
      if (!snapshot || !loadedRef.current) return;
      const quakes = featureCollection(snapshot.earthquakes.map((event) => ({
        type: 'Feature',
        properties: { magnitude: event.magnitude, label: `M${event.magnitude.toFixed(1)} · ${event.place}` },
        geometry: { type: 'Point', coordinates: [event.longitude, event.latitude] },
      })));
      const natural = featureCollection(snapshot.naturalEvents.map((event) => ({
        type: 'Feature',
        properties: { label: event.title, category: event.category },
        geometry: { type: 'Point', coordinates: [event.longitude, event.latitude] },
      })));
      const conflicts = featureCollection(snapshot.conflictSignals.map((event) => ({
        type: 'Feature',
        properties: {
          label: event.place,
          domain: event.domain,
          mentions: event.mentions,
          occurredAt: event.occurredAt,
        },
        geometry: { type: 'Point', coordinates: [event.longitude, event.latitude] },
      })));
      const iss = featureCollection(snapshot.iss ? [{
        type: 'Feature',
        properties: { label: 'ISS' },
        geometry: { type: 'Point', coordinates: [snapshot.iss.longitude, snapshot.iss.latitude] },
      }] : []);
      (map.getSource('quakes') as GeoJSONSource | undefined)?.setData(quakes);
      (map.getSource('natural') as GeoJSONSource | undefined)?.setData(natural);
      (map.getSource('conflicts') as GeoJSONSource | undefined)?.setData(conflicts);
      (map.getSource('iss') as GeoJSONSource | undefined)?.setData(iss);
    };

    map.on('load', () => {
      map.addSource('flows', { type: 'geojson', data: flowData() });
      map.addLayer({
        id: 'flows', type: 'line', source: 'flows',
        paint: { 'line-color': '#38c9e7', 'line-width': 1, 'line-opacity': 0.32, 'line-dasharray': [2, 3] },
      });
      map.addSource('flow-pulses', { type: 'geojson', data: flowPulseData(0) });
      map.addLayer({
        id: 'flow-pulse-halo', type: 'circle', source: 'flow-pulses',
        paint: { 'circle-radius': 8, 'circle-color': '#68def2', 'circle-opacity': 0.14, 'circle-blur': 0.45 },
      });
      map.addLayer({
        id: 'flow-pulses', type: 'circle', source: 'flow-pulses',
        paint: { 'circle-radius': 2.3, 'circle-color': '#d7fbff', 'circle-stroke-color': '#52d7eb', 'circle-stroke-width': 1 },
      });
      map.addSource('cities', { type: 'geojson', data: cityData() });
      map.addLayer({
        id: 'city-halo', type: 'circle', source: 'cities',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'home'], 2], 10, 6],
          'circle-color': '#68def2', 'circle-opacity': 0.16,
          'circle-blur': 0.6,
        },
      });
      map.addLayer({
        id: 'cities', type: 'circle', source: 'cities',
        paint: {
          'circle-radius': ['case', ['==', ['get', 'home'], 2], 4.5, 2.8],
          'circle-color': '#a7f1ff', 'circle-stroke-color': '#36bfdc', 'circle-stroke-width': 1,
        },
      });
      map.addLayer({
        id: 'city-labels', type: 'symbol', source: 'cities',
        layout: {
          'text-field': ['get', 'name'], 'text-size': 10, 'text-offset': [0, 1.35],
          'text-anchor': 'top', 'text-letter-spacing': 0.1, 'text-allow-overlap': false,
        },
        paint: { 'text-color': '#9ac7d2', 'text-halo-color': '#031019', 'text-halo-width': 1 },
      });
      map.addSource('quakes', { type: 'geojson', data: featureCollection([]) });
      map.addLayer({
        id: 'quake-halo', type: 'circle', source: 'quakes',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'magnitude'], 4.5, 7, 7, 20],
          'circle-color': ['case', ['>=', ['get', 'magnitude'], 6], '#ff6a4d', '#f3ad62'],
          'circle-opacity': 0.16, 'circle-blur': 0.45,
        },
      });
      map.addLayer({
        id: 'quakes', type: 'circle', source: 'quakes',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'magnitude'], 4.5, 2.5, 7, 7],
          'circle-color': ['case', ['>=', ['get', 'magnitude'], 6], '#ff725c', '#f0b172'],
          'circle-stroke-color': '#ffe0c2', 'circle-stroke-width': 0.7,
        },
      });
      map.addSource('natural', { type: 'geojson', data: featureCollection([]) });
      map.addLayer({
        id: 'natural', type: 'circle', source: 'natural',
        paint: { 'circle-radius': 3.2, 'circle-color': '#ab83ff', 'circle-opacity': 0.78, 'circle-stroke-color': '#d9c8ff', 'circle-stroke-width': 0.6 },
      });
      map.addSource('conflicts', { type: 'geojson', data: featureCollection([]) });
      map.addLayer({
        id: 'conflict-halo', type: 'circle', source: 'conflicts',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'mentions'], 1, 8, 8, 18],
          'circle-color': '#ff5f52', 'circle-opacity': 0.18, 'circle-blur': 0.5,
        },
      });
      map.addLayer({
        id: 'conflicts', type: 'circle', source: 'conflicts',
        paint: {
          'circle-radius': ['interpolate', ['linear'], ['get', 'mentions'], 1, 3.2, 8, 6.5],
          'circle-color': '#ff715d', 'circle-opacity': 0.9,
          'circle-stroke-color': '#ffd0c9', 'circle-stroke-width': 0.8,
        },
      });

      const conflictPopup = new Popup({ closeButton: false, closeOnClick: false, offset: 12 });
      map.on('mouseenter', 'conflicts', (event) => {
        map.getCanvas().style.cursor = 'pointer';
        const feature = event.features?.[0];
        if (!feature || feature.geometry.type !== 'Point') return;
        const properties = feature.properties ?? {};
        const card = document.createElement('div');
        card.className = 'conflict-popup';
        const label = document.createElement('strong');
        label.textContent = String(properties.label ?? 'Conflict media signal');
        const status = document.createElement('span');
        status.textContent = 'MEDIA SIGNAL · NOT VERIFIED EVENT';
        const source = document.createElement('small');
        source.textContent = `${properties.domain ?? 'GDELT source'} · ${properties.mentions ?? 1} mention${Number(properties.mentions ?? 1) === 1 ? '' : 's'}`;
        card.append(label, status, source);
        conflictPopup
          .setLngLat(feature.geometry.coordinates as [number, number])
          .setDOMContent(card)
          .addTo(map);
      });
      map.on('mouseleave', 'conflicts', () => {
        map.getCanvas().style.cursor = '';
        conflictPopup.remove();
      });
      map.addSource('iss', { type: 'geojson', data: featureCollection([]) });
      map.addLayer({
        id: 'iss-halo', type: 'circle', source: 'iss',
        paint: { 'circle-radius': 15, 'circle-color': '#5fe7ff', 'circle-opacity': 0.12, 'circle-blur': 0.5 },
      });
      map.addLayer({
        id: 'iss', type: 'circle', source: 'iss',
        paint: { 'circle-radius': 5, 'circle-color': '#d7fbff', 'circle-stroke-color': '#39d4ef', 'circle-stroke-width': 2 },
      });
      map.addLayer({
        id: 'iss-label', type: 'symbol', source: 'iss',
        layout: { 'text-field': 'ISS', 'text-size': 10, 'text-offset': [0, 1.4], 'text-anchor': 'top' },
        paint: { 'text-color': '#bff7ff', 'text-halo-color': '#031019', 'text-halo-width': 1 },
      });
      loadedRef.current = true;
      syncData();
    });

    let interactionUntil = 0;
    const pauseRotation = () => { interactionUntil = Date.now() + 12_000; };
    map.on('dragstart', pauseRotation);
    map.on('zoomstart', pauseRotation);
    map.on('rotatestart', pauseRotation);
    let frame = 0;
    let last = performance.now();
    const rotate = (now: number) => {
      frame = requestAnimationFrame(rotate);
      if (!loadedRef.current || document.hidden || now - last < 80) return;
      const elapsed = now - last;
      last = now;
      const softPulse = 0.5 + Math.sin(now * 0.0032) * 0.5;
      const wave = (now % 2_200) / 2_200;
      map.setPaintProperty('city-halo', 'circle-radius', [
        '*', ['case', ['==', ['get', 'home'], 2], 10, 6], 0.9 + softPulse * 0.42,
      ]);
      map.setPaintProperty('city-halo', 'circle-opacity', 0.12 + softPulse * 0.18);
      map.setPaintProperty('quake-halo', 'circle-radius', [
        '*', ['interpolate', ['linear'], ['get', 'magnitude'], 4.5, 7, 7, 20], 0.85 + wave * 1.15,
      ]);
      map.setPaintProperty('quake-halo', 'circle-opacity', 0.34 * (1 - wave) + 0.03);
      map.setPaintProperty('quakes', 'circle-opacity', 0.72 + softPulse * 0.28);
      map.setPaintProperty('natural', 'circle-radius', 3.2 + softPulse * 2.4);
      map.setPaintProperty('natural', 'circle-opacity', 0.58 + softPulse * 0.36);
      map.setPaintProperty('conflict-halo', 'circle-radius', [
        '*', ['interpolate', ['linear'], ['get', 'mentions'], 1, 8, 8, 18], 0.8 + wave * 1.3,
      ]);
      map.setPaintProperty('conflict-halo', 'circle-opacity', 0.38 * (1 - wave) + 0.03);
      map.setPaintProperty('conflicts', 'circle-opacity', 0.72 + softPulse * 0.28);
      map.setPaintProperty('iss-halo', 'circle-radius', 12 + wave * 14);
      map.setPaintProperty('iss-halo', 'circle-opacity', 0.3 * (1 - wave) + 0.03);
      map.setPaintProperty('flows', 'line-opacity', 0.2 + softPulse * 0.22);
      map.setPaintProperty('flow-pulse-halo', 'circle-radius', 6 + softPulse * 5);
      map.setPaintProperty('flow-pulse-halo', 'circle-opacity', 0.08 + softPulse * 0.18);
      (map.getSource('flow-pulses') as GeoJSONSource | undefined)?.setData(flowPulseData(now));
      if (Date.now() < interactionUntil) return;
      const center = map.getCenter();
      const longitude = ((center.lng + elapsed * 0.00022 + 180) % 360) - 180;
      map.setCenter([longitude, center.lat]);
    };
    frame = requestAnimationFrame(rotate);

    const observer = new ResizeObserver(() => map.resize());
    observer.observe(containerRef.current);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      loadedRef.current = false;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loadedRef.current || !data) return;
    const quakes = featureCollection(data.earthquakes.map((event) => ({
      type: 'Feature', properties: { magnitude: event.magnitude },
      geometry: { type: 'Point', coordinates: [event.longitude, event.latitude] },
    })));
    const natural = featureCollection(data.naturalEvents.map((event) => ({
      type: 'Feature', properties: { category: event.category },
      geometry: { type: 'Point', coordinates: [event.longitude, event.latitude] },
    })));
    const conflicts = featureCollection(data.conflictSignals.map((event) => ({
      type: 'Feature', properties: {
        label: event.place, domain: event.domain, mentions: event.mentions, occurredAt: event.occurredAt,
      },
      geometry: { type: 'Point', coordinates: [event.longitude, event.latitude] },
    })));
    const iss = featureCollection(data.iss ? [{
      type: 'Feature', properties: { label: 'ISS' },
      geometry: { type: 'Point', coordinates: [data.iss.longitude, data.iss.latitude] },
    }] : []);
    (map.getSource('quakes') as GeoJSONSource | undefined)?.setData(quakes);
    (map.getSource('natural') as GeoJSONSource | undefined)?.setData(natural);
    (map.getSource('conflicts') as GeoJSONSource | undefined)?.setData(conflicts);
    (map.getSource('iss') as GeoJSONSource | undefined)?.setData(iss);
  }, [data]);

  return <div ref={containerRef} className="mobi-globe" aria-label="Interactive globe with live public data" />;
}
