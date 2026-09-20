'use client';

import { useEffect, useRef } from 'react';
import { Map as MapLibreMap, type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
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
    basemap: {
      type: 'raster',
      tiles: [
        'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      ],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    { id: 'background', type: 'background', paint: { 'background-color': '#030b11' } },
    {
      id: 'basemap', type: 'raster', source: 'basemap',
      paint: {
        'raster-opacity': 0.82,
        'raster-saturation': -1,
        'raster-contrast': 0.35,
        'raster-brightness-min': 0,
        'raster-brightness-max': 0.24,
      },
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
    const map = new MapLibreMap({
      container: containerRef.current,
      style: BASEMAP_STYLE,
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
      const iss = featureCollection(snapshot.iss ? [{
        type: 'Feature',
        properties: { label: 'ISS' },
        geometry: { type: 'Point', coordinates: [snapshot.iss.longitude, snapshot.iss.latitude] },
      }] : []);
      (map.getSource('quakes') as GeoJSONSource | undefined)?.setData(quakes);
      (map.getSource('natural') as GeoJSONSource | undefined)?.setData(natural);
      (map.getSource('iss') as GeoJSONSource | undefined)?.setData(iss);
    };

    map.on('load', () => {
      map.addSource('flows', { type: 'geojson', data: flowData() });
      map.addLayer({
        id: 'flows', type: 'line', source: 'flows',
        paint: { 'line-color': '#38c9e7', 'line-width': 1, 'line-opacity': 0.32, 'line-dasharray': [2, 3] },
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
          'text-field': ['get', 'name'], 'text-size': 9, 'text-offset': [0, 1.35],
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
      if (!loadedRef.current || document.hidden || Date.now() < interactionUntil || now - last < 80) return;
      const elapsed = now - last;
      last = now;
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
    const iss = featureCollection(data.iss ? [{
      type: 'Feature', properties: { label: 'ISS' },
      geometry: { type: 'Point', coordinates: [data.iss.longitude, data.iss.latitude] },
    }] : []);
    (map.getSource('quakes') as GeoJSONSource | undefined)?.setData(quakes);
    (map.getSource('natural') as GeoJSONSource | undefined)?.setData(natural);
    (map.getSource('iss') as GeoJSONSource | undefined)?.setData(iss);
  }, [data]);

  return <div ref={containerRef} className="mobi-globe" aria-label="Interactive globe with live public data" />;
}
