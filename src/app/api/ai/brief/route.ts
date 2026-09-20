import { NextResponse } from 'next/server';
import OpenAI from 'openai';
import { getIntelligenceSnapshot, type IntelligenceSnapshot } from '@/lib/mobi-intelligence';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type SignalLevel = 'info' | 'watch' | 'elevated';
interface BriefSignal { level: SignalLevel; title: string; detail: string; source: string }
interface AnalystBrief {
  summary: string;
  assessment: 'NOMINAL' | 'WATCH' | 'ELEVATED';
  confidence: number;
  signals: BriefSignal[];
  generatedAt: string;
  generatedBy: 'mobi-ai' | 'analytical-fallback';
  model: string;
}

type GlobalWithBriefCache = typeof globalThis & {
  __mobiBriefCache?: { value: AnalystBrief; expiresAt: number };
};

function fallbackBrief(data: IntelligenceSnapshot): AnalystBrief {
  const signals: BriefSignal[] = [];
  const strongest = [...data.earthquakes].sort((a, b) => b.magnitude - a.magnitude)[0];
  if (strongest) {
    signals.push({
      level: strongest.magnitude >= 6 ? 'elevated' : strongest.magnitude >= 5 ? 'watch' : 'info',
      title: `SEISMIC M${strongest.magnitude.toFixed(1)}`,
      detail: strongest.place,
      source: 'USGS',
    });
  }
  const mover = [...data.markets].filter((item) => item.change !== null)
    .sort((a, b) => Math.abs(b.change ?? 0) - Math.abs(a.change ?? 0))[0];
  if (mover) {
    signals.push({
      level: Math.abs(mover.change ?? 0) >= 5 ? 'watch' : 'info',
      title: `${mover.symbol} ${(mover.change ?? 0) >= 0 ? '+' : ''}${(mover.change ?? 0).toFixed(2)}%`,
      detail: 'Largest monitored market movement in the current snapshot.',
      source: 'COINGECKO / FRANKFURTER',
    });
  }
  if (data.spaceWeather) {
    signals.push({
      level: data.spaceWeather.kp >= 5 ? 'elevated' : data.spaceWeather.kp >= 4 ? 'watch' : 'info',
      title: `GEOMAGNETIC Kp ${data.spaceWeather.kp.toFixed(1)}`,
      detail: `${data.spaceWeather.level} geomagnetic conditions.`,
      source: 'NOAA SWPC',
    });
  }
  if (data.conflictSignals.length) {
    const leading = [...data.conflictSignals].sort((a, b) => b.mentions - a.mentions)[0];
    signals.push({
      level: 'info',
      title: `${data.conflictSignals.length} CONFLICT MEDIA SIGNALS`,
      detail: `Highest monitored concentration: ${leading.place} (${leading.mentions} mentions). These are media indicators, not verified conflict events.`,
      source: 'GDELT GKG',
    });
  }
  if (data.naturalEvents.length) {
    signals.push({
      level: 'info',
      title: `${data.naturalEvents.length} NATURAL EVENTS`,
      detail: 'Open events currently mapped by the NASA EONET feed.',
      source: 'NASA EONET',
    });
  }

  const liveCount = Object.values(data.sources).filter((source) => source.state === 'live').length;
  const elevated = signals.some((signal) => signal.level === 'elevated');
  const watch = signals.some((signal) => signal.level === 'watch');
  return {
    summary: liveCount
      ? `${liveCount} of ${Object.keys(data.sources).length} monitored sources are live. The read-out reflects current source data and does not infer relationships between unrelated events.`
      : 'Live sources are unavailable. No operational assessment can be generated from the current snapshot.',
    assessment: elevated ? 'ELEVATED' : watch ? 'WATCH' : 'NOMINAL',
    confidence: Math.round((liveCount / Math.max(1, Object.keys(data.sources).length)) * 82),
    signals: signals.slice(0, 4),
    generatedAt: new Date().toISOString(),
    generatedBy: 'analytical-fallback',
    model: 'RULE-BASED / NO MODEL',
  };
}

function validateBrief(
  value: unknown,
  data: IntelligenceSnapshot,
): Omit<AnalystBrief, 'generatedAt' | 'generatedBy' | 'model'> | null {
  if (!value || typeof value !== 'object') return null;
  const item = value as Record<string, unknown>;
  if (typeof item.summary !== 'string' || item.summary.length < 10 || item.summary.length > 900) return null;
  if (!['NOMINAL', 'WATCH', 'ELEVATED'].includes(String(item.assessment))) return null;
  const confidence = Number(item.confidence);
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 100 || !Array.isArray(item.signals)) return null;
  const signals = item.signals.slice(0, 4).flatMap((signal) => {
    if (!signal || typeof signal !== 'object') return [];
    const row = signal as Record<string, unknown>;
    if (!['info', 'watch', 'elevated'].includes(String(row.level))) return [];
    if (![row.title, row.detail, row.source].every((field) => typeof field === 'string')) return [];
    const source = String(row.source).toUpperCase();
    let level = row.level as SignalLevel;
    if (source.includes('USGS')) {
      const magnitude = Math.max(0, ...data.earthquakes.map((event) => event.magnitude));
      level = magnitude >= 6 ? 'elevated' : magnitude >= 5 ? 'watch' : 'info';
    } else if (source.includes('NOAA')) {
      const kp = data.spaceWeather?.kp ?? 0;
      level = kp >= 5 ? 'elevated' : kp >= 4 ? 'watch' : 'info';
    } else if (source.includes('EONET') || source.includes('NASA')) {
      level = 'info';
    } else if (source.includes('GDELT')) {
      level = 'info';
    } else if (['COINGECKO', 'KRAKEN', 'FRANKFURTER', 'FX'].some((name) => source.includes(name))) {
      const movement = Math.max(0, ...data.markets.map((market) => Math.abs(market.change ?? 0)));
      level = movement >= 5 ? 'elevated' : movement >= 3 ? 'watch' : 'info';
    }
    return [{
      level,
      title: String(row.title).slice(0, 80),
      detail: String(row.detail).slice(0, 240),
      source: String(row.source).slice(0, 80),
    }];
  });
  const assessment: AnalystBrief['assessment'] = signals.some((signal) => signal.level === 'elevated')
    ? 'ELEVATED'
    : signals.some((signal) => signal.level === 'watch') ? 'WATCH' : 'NOMINAL';
  return {
    summary: item.summary.trim(),
    assessment,
    confidence: Math.round(confidence),
    signals,
  };
}

function compactSnapshot(data: IntelligenceSnapshot) {
  return {
    generatedAt: data.generatedAt,
    sourceStatus: data.sources,
    markets: data.markets,
    strongestEarthquakes: [...data.earthquakes].sort((a, b) => b.magnitude - a.magnitude).slice(0, 8),
    recentNaturalEvents: data.naturalEvents.slice(0, 8),
    conflictMediaSignals: data.conflictSignals.slice(0, 12),
    iss: data.iss,
    spaceWeather: data.spaceWeather,
  };
}

async function generateModelBrief(data: IntelligenceSnapshot): Promise<AnalystBrief | null> {
  const apiKey = process.env.NETLIFY_AI_GATEWAY_KEY || process.env.OPENAI_API_KEY;
  const baseURL = process.env.NETLIFY_AI_GATEWAY_URL || process.env.OPENAI_BASE_URL;
  if (!apiKey || !baseURL) {
    console.warn('[MOBI AI] Netlify AI Gateway credentials are unavailable.');
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 7_500);
  try {
    const client = new OpenAI({ apiKey, baseURL, timeout: 7_500, maxRetries: 0 });
    const response = await client.chat.completions.create({
        model: process.env.MOBI_AI_MODEL || 'gpt-5-nano',
        max_completion_tokens: 700,
        reasoning_effort: 'minimal',
        response_format: { type: 'json_object' },
        messages: [
          {
            role: 'system',
            content: 'You are MOBI AI ANALYST. Analyze only the supplied public data. Never invent events, causal links, sources, casualties, or forecasts. Distinguish observation from inference. Return compact valid JSON with: summary, assessment (NOMINAL|WATCH|ELEVATED), confidence (0-100), and signals (maximum four objects with level info|watch|elevated, title, detail, source). Cite the supplied source in every signal. GDELT conflictMediaSignals are media mentions near the ARMEDCONFLICT theme, not verified battlefield events: always label them as media signals and assign info level only. Use elevated only for earthquake magnitude >=6, absolute market movement >=5%, or Kp >=5; use watch for earthquake magnitude >=5, absolute market movement >=3%, or Kp >=4. An EONET event without supplied numeric severity is info. Assessment must equal the highest signal level. Keep the summary below 80 words.',
          },
          { role: 'user', content: JSON.stringify(compactSnapshot(data)) },
        ],
      }, { signal: controller.signal });
    const raw = response.choices[0]?.message?.content;
    if (!raw) {
      console.log('[MOBI AI] empty model response:', response.choices[0]?.finish_reason || 'unknown');
      return null;
    }
    const parsed = validateBrief(JSON.parse(raw), data);
    if (!parsed) {
      console.log('[MOBI AI] model response failed schema validation.');
      return null;
    }
    return {
      ...parsed,
      generatedAt: new Date().toISOString(),
      generatedBy: 'mobi-ai',
      model: process.env.MOBI_AI_MODEL || 'gpt-5-nano',
    };
  } catch (error) {
    console.warn('[MOBI AI] model request failed:', error instanceof Error ? error.message : 'unknown error');
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function GET() {
  const cacheHost = globalThis as GlobalWithBriefCache;
  if (cacheHost.__mobiBriefCache && cacheHost.__mobiBriefCache.expiresAt > Date.now()) {
    return NextResponse.json(cacheHost.__mobiBriefCache.value, {
      headers: { 'Cache-Control': 'private, no-store' },
    });
  }

  const snapshot = await getIntelligenceSnapshot();
  const brief = await generateModelBrief(snapshot) ?? fallbackBrief(snapshot);
  cacheHost.__mobiBriefCache = { value: brief, expiresAt: Date.now() + 15 * 60_000 };
  return NextResponse.json(brief, {
    headers: {
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
