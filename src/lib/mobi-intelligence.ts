import { degreesLat, degreesLong, eciToGeodetic, gstime, json2satrec, propagate } from 'satellite.js';

export type SourceState = 'live' | 'stale' | 'offline';

export interface SourceStatus {
  state: SourceState;
  updatedAt: string | null;
  label: string;
}

export interface MarketPoint {
  symbol: 'BTC' | 'ETH' | 'EUR';
  price: number;
  change: number | null;
  updatedAt: string;
}

export interface QuakePoint {
  id: string;
  latitude: number;
  longitude: number;
  magnitude: number;
  place: string;
  occurredAt: string;
}

export interface NaturalEvent {
  id: string;
  title: string;
  category: string;
  latitude: number;
  longitude: number;
  occurredAt: string;
}

export interface ConflictSignal {
  id: string;
  latitude: number;
  longitude: number;
  place: string;
  occurredAt: string;
  domain: string;
  url: string;
  tone: number | null;
  mentions: number;
  verification: 'media-signal';
}

export interface IntelligenceSnapshot {
  generatedAt: string;
  sources: Record<string, SourceStatus>;
  markets: MarketPoint[];
  earthquakes: QuakePoint[];
  naturalEvents: NaturalEvent[];
  conflictSignals: ConflictSignal[];
  iss: { latitude: number; longitude: number; altitudeKm: number; updatedAt: string } | null;
  spaceWeather: { kp: number; observedAt: string; level: string } | null;
}

type CachedSource = { data: unknown; updatedAt: string };
type GlobalWithCache = typeof globalThis & { __mobiSourceCache?: Map<string, CachedSource> };
const globalCache = globalThis as GlobalWithCache;
const sourceCache = globalCache.__mobiSourceCache ?? new Map<string, CachedSource>();
globalCache.__mobiSourceCache = sourceCache;

const SOURCE_LABELS: Record<string, string> = {
  markets: 'COINGECKO / KRAKEN + FX',
  earthquakes: 'USGS',
  naturalEvents: 'NASA EONET',
  conflictSignals: 'GDELT GKG · MEDIA SIGNALS',
  iss: 'CELESTRAK / SGP4',
  spaceWeather: 'NOAA SWPC',
};

async function fetchJson(url: string, revalidate: number, timeoutMs = 8_000): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      headers: {
        accept: 'application/json',
        'user-agent': 'MOBI.DIGITAL-Global-Intelligence/1.0',
      },
      signal: controller.signal,
      next: { revalidate },
    });
    if (!response.ok) throw new Error(`Upstream returned ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function loadSource<T>(
  key: string,
  loader: () => Promise<T>,
): Promise<{ data: T | null; status: SourceStatus }> {
  try {
    const data = await loader();
    const updatedAt = new Date().toISOString();
    sourceCache.set(key, { data, updatedAt });
    return { data, status: { state: 'live', updatedAt, label: SOURCE_LABELS[key] } };
  } catch {
    const cached = sourceCache.get(key);
    if (cached) {
      return {
        data: cached.data as T,
        status: { state: 'stale', updatedAt: cached.updatedAt, label: SOURCE_LABELS[key] },
      };
    }
    return { data: null, status: { state: 'offline', updatedAt: null, label: SOURCE_LABELS[key] } };
  }
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

async function loadMarkets(): Promise<MarketPoint[]> {
  const start = new Date(Date.now() - 9 * 86_400_000).toISOString().slice(0, 10);
  const [cryptoResult, krakenResult, fxResult] = await Promise.allSettled([
    fetchJson('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin%2Cethereum&vs_currencies=usd&include_24hr_change=true&include_last_updated_at=true', 60),
    fetchJson('https://api.kraken.com/0/public/Ticker?pair=XBTUSD,ETHUSD', 60),
    fetchJson(`https://api.frankfurter.dev/v1/${start}..?base=EUR&symbols=USD`, 3_600),
  ]);

  const markets: MarketPoint[] = [];
  if (cryptoResult.status === 'fulfilled') {
    const crypto = cryptoResult.value as Record<string, Record<string, unknown>>;
    for (const [id, symbol] of [['bitcoin', 'BTC'], ['ethereum', 'ETH']] as const) {
      const item = crypto[id];
      if (item && finite(item.usd) && finite(item.usd_24h_change) && finite(item.last_updated_at)) {
        markets.push({
          symbol,
          price: item.usd,
          change: item.usd_24h_change,
          updatedAt: new Date(item.last_updated_at * 1_000).toISOString(),
        });
      }
    }
  }

  if (!markets.some((market) => market.symbol === 'BTC') && krakenResult.status === 'fulfilled') {
    const kraken = krakenResult.value as { result?: Record<string, { c?: unknown[]; o?: unknown }> };
    for (const [key, symbol] of [['XXBTZUSD', 'BTC'], ['XETHZUSD', 'ETH']] as const) {
      const ticker = kraken.result?.[key];
      const price = Number(ticker?.c?.[0]);
      const open = Number(ticker?.o);
      if (Number.isFinite(price) && Number.isFinite(open) && open > 0) {
        markets.push({
          symbol,
          price,
          change: ((price / open) - 1) * 100,
          updatedAt: new Date().toISOString(),
        });
      }
    }
  }

  if (fxResult.status === 'fulfilled') {
    const fx = fxResult.value as { rates?: Record<string, { USD?: unknown }> };
    const rows = Object.entries(fx.rates ?? {})
      .map(([date, value]) => ({ date, value: value.USD }))
      .filter((row): row is { date: string; value: number } => finite(row.value))
      .sort((a, b) => a.date.localeCompare(b.date));
    const current = rows.at(-1);
    const previous = rows.at(-2);
    if (current) {
      markets.push({
        symbol: 'EUR',
        price: current.value,
        change: previous ? ((current.value / previous.value) - 1) * 100 : null,
        updatedAt: new Date(`${current.date}T00:00:00Z`).toISOString(),
      });
    }
  }

  if (!markets.length) throw new Error('No valid market data');
  return markets;
}

async function loadEarthquakes(): Promise<QuakePoint[]> {
  const json = await fetchJson('https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson', 300) as {
    features?: Array<{
      id?: unknown;
      geometry?: { coordinates?: unknown[] };
      properties?: { mag?: unknown; place?: unknown; time?: unknown };
    }>;
  };
  const result = (json.features ?? []).flatMap((feature) => {
    const coordinates = feature.geometry?.coordinates;
    const magnitude = feature.properties?.mag;
    const occurredAt = feature.properties?.time;
    if (!Array.isArray(coordinates) || !finite(coordinates[0]) || !finite(coordinates[1]) || !finite(magnitude) || !finite(occurredAt)) return [];
    return [{
      id: String(feature.id ?? `${coordinates[0]}-${coordinates[1]}-${occurredAt}`),
      longitude: coordinates[0],
      latitude: coordinates[1],
      magnitude,
      place: String(feature.properties?.place ?? 'Unknown region'),
      occurredAt: new Date(occurredAt).toISOString(),
    }];
  }).sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)).slice(0, 24);
  return result;
}

function firstCoordinate(value: unknown): [number, number] | null {
  if (!Array.isArray(value)) return null;
  if (finite(value[0]) && finite(value[1])) return [value[0], value[1]];
  for (const child of value) {
    const coordinate = firstCoordinate(child);
    if (coordinate) return coordinate;
  }
  return null;
}

async function loadNaturalEvents(): Promise<NaturalEvent[]> {
  const json = await fetchJson('https://eonet.gsfc.nasa.gov/api/v3/events?status=open&days=30&limit=24', 900) as {
    events?: Array<{
      id?: unknown;
      title?: unknown;
      categories?: Array<{ title?: unknown }>;
      geometry?: Array<{ date?: unknown; coordinates?: unknown }>;
    }>;
  };
  return (json.events ?? []).flatMap((event) => {
    const geometry = event.geometry?.at(-1);
    const coordinate = firstCoordinate(geometry?.coordinates);
    const timestamp = typeof geometry?.date === 'string' ? Date.parse(geometry.date) : Number.NaN;
    if (!coordinate || !Number.isFinite(timestamp)) return [];
    return [{
      id: String(event.id ?? `${coordinate[0]}-${coordinate[1]}`),
      title: String(event.title ?? 'Natural event'),
      category: String(event.categories?.[0]?.title ?? 'Natural event'),
      longitude: coordinate[0],
      latitude: coordinate[1],
      occurredAt: new Date(timestamp).toISOString(),
    }];
  }).sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)).slice(0, 18);
}

async function loadConflictSignals(): Promise<ConflictSignal[]> {
  const parameters = new URLSearchParams({
    QUERY: 'ARMEDCONFLICT',
    TIMESPAN: '1440',
    MAXROWS: '160',
    OUTPUTFIELDS: 'url,name,domain,tone,lang',
  });
  const json = await fetchJson(
    `https://api.gdeltproject.org/api/v1/gkg_geojson?${parameters}`,
    900,
    18_000,
  ) as {
    features?: Array<{
      geometry?: { type?: unknown; coordinates?: unknown[] };
      properties?: {
        urlpubtimedate?: unknown;
        name?: unknown;
        urltone?: unknown;
        domain?: unknown;
        url?: unknown;
      };
    }>;
  };

  const aggregated = new Map<string, ConflictSignal>();
  for (const feature of json.features ?? []) {
    const coordinates = feature.geometry?.coordinates;
    const properties = feature.properties;
    const timestamp = typeof properties?.urlpubtimedate === 'string'
      ? Date.parse(properties.urlpubtimedate)
      : Number.NaN;
    if (
      feature.geometry?.type !== 'Point'
      || !Array.isArray(coordinates)
      || !finite(coordinates[0])
      || !finite(coordinates[1])
      || !Number.isFinite(timestamp)
    ) continue;

    const longitude = coordinates[0];
    const latitude = coordinates[1];
    if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) continue;
    const place = String(properties?.name ?? 'Unspecified location').trim().slice(0, 120);
    const domain = String(properties?.domain ?? 'unknown source').trim().slice(0, 120);
    const url = typeof properties?.url === 'string' && /^https?:\/\//.test(properties.url)
      ? properties.url.slice(0, 1_500)
      : '';
    const toneValue = Number(properties?.urltone);
    const key = `${latitude.toFixed(2)}:${longitude.toFixed(2)}:${place.toLowerCase()}`;
    const existing = aggregated.get(key);
    const occurredAt = new Date(timestamp).toISOString();
    if (existing) {
      existing.mentions += 1;
      if (Date.parse(occurredAt) > Date.parse(existing.occurredAt)) {
        existing.occurredAt = occurredAt;
        existing.domain = domain;
        existing.url = url;
        existing.tone = Number.isFinite(toneValue) ? toneValue : null;
      }
      continue;
    }
    aggregated.set(key, {
      id: key,
      longitude,
      latitude,
      place,
      occurredAt,
      domain,
      url,
      tone: Number.isFinite(toneValue) ? toneValue : null,
      mentions: 1,
      verification: 'media-signal',
    });
  }

  const result = [...aggregated.values()]
    .sort((a, b) => b.mentions - a.mentions || Date.parse(b.occurredAt) - Date.parse(a.occurredAt))
    .slice(0, 24);
  if (!result.length) throw new Error('No valid conflict media signals');
  return result;
}

async function loadIss(): Promise<IntelligenceSnapshot['iss']> {
  const json = await fetchJson('https://celestrak.org/NORAD/elements/gp.php?CATNR=25544&FORMAT=JSON', 1_800) as Array<Record<string, unknown>>;
  if (!json?.[0] || Number(json[0].NORAD_CAT_ID) !== 25544) throw new Error('Invalid ISS orbit elements');
  const now = new Date();
  const state = propagate(json2satrec(json[0] as never), now);
  if (!state.position || typeof state.position === 'boolean') throw new Error('Unable to propagate ISS orbit');
  const geodetic = eciToGeodetic(state.position, gstime(now));
  return {
    latitude: degreesLat(geodetic.latitude),
    longitude: degreesLong(geodetic.longitude),
    altitudeKm: geodetic.height,
    updatedAt: now.toISOString(),
  };
}

async function loadSpaceWeather(): Promise<IntelligenceSnapshot['spaceWeather']> {
  const json = await fetchJson('https://services.swpc.noaa.gov/products/noaa-planetary-k-index.json', 600) as unknown[];
  if (!Array.isArray(json)) throw new Error('Invalid space weather response');
  const rows = json.flatMap((row) => {
    const timeValue = Array.isArray(row) ? row[0] : (row as Record<string, unknown>)?.time_tag;
    const kpValue = Array.isArray(row) ? row[1] : (row as Record<string, unknown>)?.Kp;
    if (typeof timeValue !== 'string') return [];
    const kp = Number(kpValue);
    const observedAt = Date.parse(`${timeValue.replace(' ', 'T').replace(/Z$/, '')}Z`);
    return Number.isFinite(kp) && Number.isFinite(observedAt) ? [{ kp, observedAt }] : [];
  }).sort((a, b) => b.observedAt - a.observedAt);
  const latest = rows[0];
  if (!latest) throw new Error('No valid space weather rows');
  const level = latest.kp >= 7 ? 'SEVERE' : latest.kp >= 5 ? 'STORM' : latest.kp >= 4 ? 'ACTIVE' : 'NOMINAL';
  return { kp: latest.kp, observedAt: new Date(latest.observedAt).toISOString(), level };
}

export async function getIntelligenceSnapshot(): Promise<IntelligenceSnapshot> {
  const [markets, earthquakes, naturalEvents, conflictSignals, iss, spaceWeather] = await Promise.all([
    loadSource('markets', loadMarkets),
    loadSource('earthquakes', loadEarthquakes),
    loadSource('naturalEvents', loadNaturalEvents),
    loadSource('conflictSignals', loadConflictSignals),
    loadSource('iss', loadIss),
    loadSource('spaceWeather', loadSpaceWeather),
  ]);

  return {
    generatedAt: new Date().toISOString(),
    sources: {
      markets: markets.status,
      earthquakes: earthquakes.status,
      naturalEvents: naturalEvents.status,
      conflictSignals: conflictSignals.status,
      iss: iss.status,
      spaceWeather: spaceWeather.status,
    },
    markets: markets.data ?? [],
    earthquakes: earthquakes.data ?? [],
    naturalEvents: naturalEvents.data ?? [],
    conflictSignals: conflictSignals.data ?? [],
    iss: iss.data,
    spaceWeather: spaceWeather.data,
  };
}
