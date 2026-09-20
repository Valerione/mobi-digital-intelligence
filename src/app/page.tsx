'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import {
  Activity, BrainCircuit, CircleDot, Database, Globe2, Orbit,
  RefreshCw, ShieldCheck, Sparkles, TrendingUp,
} from 'lucide-react';
import type { IntelligenceSnapshot, MarketPoint, SourceState } from '@/lib/mobi-intelligence';

const MobiGlobe = dynamic(() => import('@/components/MobiGlobe'), {
  ssr: false,
  loading: () => <div className="globe-loading">LOADING GEO-SPATIAL LAYER</div>,
});

interface AnalystBrief {
  summary: string;
  assessment: 'NOMINAL' | 'WATCH' | 'ELEVATED';
  confidence: number;
  signals: Array<{ level: 'info' | 'watch' | 'elevated'; title: string; detail: string; source: string }>;
  generatedAt: string;
  generatedBy: 'mobi-ai' | 'analytical-fallback';
  model: string;
}

interface FeedItem {
  key: string;
  category: string;
  title: string;
  source: string;
  time: string;
  tone: 'cyan' | 'amber' | 'violet';
}

const clockRome = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Rome', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
const clockUtc = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'UTC', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
});
const dateRome = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Rome', weekday: 'short', day: '2-digit', month: 'short', year: 'numeric',
});

function timeAgo(value: string) {
  const seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1_000));
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
  return `${Math.floor(seconds / 86_400)}d ago`;
}

function formatPrice(market: MarketPoint) {
  const digits = market.symbol === 'EUR' ? 4 : market.price < 10 ? 3 : 2;
  return market.price.toLocaleString('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: digits, maximumFractionDigits: digits,
  });
}

function stateLabel(state: SourceState) {
  return state === 'live' ? 'LIVE' : state === 'stale' ? 'STALE' : 'OFFLINE';
}

function LiteGlobe({ data }: { data: IntelligenceSnapshot | null }) {
  const entities = data ? data.earthquakes.length + data.naturalEvents.length + (data.iss ? 1 : 0) : 0;
  return (
    <div className="lite-globe" aria-label="Lightweight mobile global overview">
      <div className="lite-sphere" aria-hidden="true">
        <i className="lite-orbit orbit-one" />
        <i className="lite-orbit orbit-two" />
        <i className="lite-node node-rome" />
        <i className="lite-node node-americas" />
        <i className="lite-node node-asia" />
      </div>
      <div className="lite-readout">
        <strong>{data ? `${entities} LIVE ENTITIES` : 'CONNECTING TO PUBLIC DATA'}</strong>
        <span>{data ? `${data.earthquakes.length} SEISMIC · ${data.naturalEvents.length} NATURAL · ${data.iss ? 'ISS ACTIVE' : 'ISS WAITING'}` : 'MOBILE LOW-BANDWIDTH MODE'}</span>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const [now, setNow] = useState<Date | null>(null);
  const [data, setData] = useState<IntelligenceSnapshot | null>(null);
  const [brief, setBrief] = useState<AnalystBrief | null>(null);
  const [networkState, setNetworkState] = useState<'connecting' | 'online' | 'degraded'>('connecting');
  const [dataLoading, setDataLoading] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [supportsLiveMap, setSupportsLiveMap] = useState(false);
  const [useLiveMap, setUseLiveMap] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(max-width: 680px), (hover: none) and (pointer: coarse)');
    const syncMode = () => {
      let webglAvailable = false;
      try {
        const canvas = document.createElement('canvas');
        webglAvailable = Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
      } catch {
        webglAvailable = false;
      }
      const available = !media.matches && webglAvailable;
      setSupportsLiveMap(available);
      if (!available) setUseLiveMap(false);
    };
    syncMode();
    media.addEventListener?.('change', syncMode);
    return () => media.removeEventListener?.('change', syncMode);
  }, []);

  const loadIntelligence = useCallback(async () => {
    if (document.hidden) return;
    setDataLoading(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch('/api/intelligence', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const snapshot = await response.json() as IntelligenceSnapshot;
      setData(snapshot);
      setNetworkState(Object.values(snapshot.sources).some((source) => source.state === 'live') ? 'online' : 'degraded');
    } catch {
      setNetworkState('degraded');
    } finally {
      clearTimeout(timeout);
      setDataLoading(false);
    }
  }, []);

  const loadBrief = useCallback(async () => {
    if (document.hidden) return;
    setAiLoading(true);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    try {
      const response = await fetch('/api/ai/brief', { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      setBrief(await response.json() as AnalystBrief);
    } catch {
      // Keep the last valid brief visible during a transient failure.
    } finally {
      clearTimeout(timeout);
      setAiLoading(false);
    }
  }, []);

  useEffect(() => {
    const clockStart = setTimeout(() => setNow(new Date()), 0);
    const clock = setInterval(() => setNow(new Date()), 1_000);
    const startup = setTimeout(() => {
      void Promise.allSettled([loadIntelligence(), loadBrief()]);
    }, 0);
    const dataTimer = setInterval(loadIntelligence, 60_000);
    const aiTimer = setInterval(loadBrief, 15 * 60_000);
    const resume = () => {
      if (!document.hidden) void Promise.allSettled([loadIntelligence(), loadBrief()]);
    };
    document.addEventListener('visibilitychange', resume);
    return () => {
      clearInterval(clock);
      clearTimeout(clockStart);
      clearTimeout(startup);
      clearInterval(dataTimer);
      clearInterval(aiTimer);
      document.removeEventListener('visibilitychange', resume);
    };
  }, [loadBrief, loadIntelligence]);

  const feed = useMemo<FeedItem[]>(() => {
    if (!data) return [];
    const items: FeedItem[] = data.earthquakes.slice(0, 5).map((event) => ({
      key: `quake-${event.id}`,
      category: 'EARTHQUAKE',
      title: `M ${event.magnitude.toFixed(1)} · ${event.place}`,
      source: 'USGS', time: event.occurredAt,
      tone: event.magnitude >= 6 ? 'amber' : 'cyan',
    }));
    for (const event of data.naturalEvents.slice(0, 3)) {
      items.push({
        key: `natural-${event.id}`, category: event.category.toUpperCase(), title: event.title,
        source: 'NASA EONET', time: event.occurredAt, tone: 'violet',
      });
    }
    if (data.spaceWeather) {
      items.push({
        key: 'space-weather', category: 'SPACE WEATHER',
        title: `Kp ${data.spaceWeather.kp.toFixed(1)} · ${data.spaceWeather.level}`,
        source: 'NOAA SWPC', time: data.spaceWeather.observedAt,
        tone: data.spaceWeather.kp >= 5 ? 'amber' : 'cyan',
      });
    }
    return items.sort((a, b) => Date.parse(b.time) - Date.parse(a.time)).slice(0, 8);
  }, [data]);

  const liveSources = data ? Object.values(data.sources).filter((source) => source.state === 'live').length : 0;
  const totalSources = data ? Object.keys(data.sources).length : 5;
  const ticker = [
    'MOBI.DIGITAL GLOBAL INTELLIGENCE',
    ...((data?.markets ?? []).map((market) => `${market.symbol}/USD ${formatPrice(market)}${market.change === null ? '' : ` ${market.change >= 0 ? '+' : ''}${market.change.toFixed(2)}%`}`)),
    data ? `USGS ${data.earthquakes.length} SIGNIFICANT EVENTS` : null,
    data?.iss ? 'ISS TRACKING ACTIVE' : null,
    brief ? `MOBI AI ${brief.assessment}` : null,
    'ROME NODE ONLINE',
  ].filter(Boolean).join('  •  ');

  return (
    <main className="command-center">
      <div className="scanlines" aria-hidden="true" />

      <header className="topbar">
        <div className="brand-block">
          <div className="brand">MOBI<span>.</span>DIGITAL</div>
          <div className="brand-sub">AI COMPANY <b>{'//'}</b> GLOBAL INTELLIGENCE</div>
        </div>
        <div className="mission"><Globe2 size={14} /> GLOBAL SITUATIONAL AWARENESS <Globe2 size={14} /></div>
        <div className="clock-cluster">
          <div className={`system-pill ${networkState}`}><i /> {networkState === 'degraded' ? 'NETWORK DEGRADED' : networkState === 'connecting' ? 'CONNECTING' : 'SYSTEM ONLINE'}</div>
          <div><small>ROME</small><strong>{now ? clockRome.format(now) : '--:--:--'}</strong></div>
          <div><small>UTC</small><strong>{now ? clockUtc.format(now) : '--:--:--'}</strong></div>
          <time>{now ? dateRome.format(now).toUpperCase() : 'SYNCING CLOCK'}</time>
        </div>
      </header>

      <section className="workspace">
        <aside className="side-panel intelligence-feed">
          <div className="section-kicker"><span>01 / LIVE SIGNALS</span><Activity size={13} /></div>
          <h1>GLOBAL EVENTS</h1>
          <div className="rule" />
          <div className={`feed-list ${feed.length > 2 ? 'is-scrolling' : ''}`} aria-label="Global events from public data sources">
            {!feed.length && <div className="empty-state">AWAITING VERIFIED SOURCES</div>}
            {!!feed.length && (
              <div className="feed-track">
                {(feed.length > 2 ? [0, 1] : [0]).map((setIndex) => (
                  <div className="feed-set" aria-hidden={setIndex === 1 || undefined} key={setIndex}>
                    {feed.map((item) => (
                      <article className={`feed-item ${item.tone}`} key={`${setIndex}-${item.key}`}>
                        <div className="feed-meta"><span>{item.category}</span><time>{timeAgo(item.time)}</time></div>
                        <p>{item.title}</p>
                        <small>{item.source} · {new Date(item.time).toISOString().slice(11, 19)} UTC</small>
                      </article>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="sources-card">
            <div className="mini-title"><span>LIVE SOURCES</span><b>{liveSources}/{totalSources}</b></div>
            {Object.entries(data?.sources ?? {}).map(([key, source]) => (
              <div className="source-row" key={key}>
                <span>{source.label}</span>
                <strong className={source.state}><i /> {stateLabel(source.state)}</strong>
              </div>
            ))}
            {!data && <div className="source-row"><span>PUBLIC DATA GRID</span><strong className="offline"><i /> CONNECTING</strong></div>}
          </div>
        </aside>

        <section className="globe-stage">
          <div className="stage-header">
            <span>GEO-SPATIAL OVERVIEW / LIVE</span>
            <span>HOME NODE 41.9028° N · 12.4964° E</span>
          </div>
          <div className="globe-frame">{useLiveMap ? <MobiGlobe data={data} /> : <LiteGlobe data={data} />}</div>
          {supportsLiveMap && (
            <button className="globe-mode-button" onClick={() => setUseLiveMap((active) => !active)}>
              {useLiveMap ? 'LITE GLOBE' : 'ENABLE LIVE MAP'}
            </button>
          )}
          <div className="map-readout map-readout-left">ROME // MOBI.DIGITAL</div>
          <div className="map-readout map-readout-right">LIVE MERCATOR GRID</div>
          <div className="legend">
            <span><i className="city" /> CITY NODE</span>
            <span><i className="quake" /> EARTHQUAKE</span>
            <span><i className="natural" /> NATURAL EVENT</span>
            <span><i className="iss" /> ISS</span>
          </div>
          <div className="stage-footer">
            <span><i className="pulse-dot" /> GLOBAL DATA FLOW</span>
            <span>{data ? `${data.earthquakes.length + data.naturalEvents.length + (data.iss ? 1 : 0)} LIVE ENTITIES` : 'SYNCHRONIZING'}</span>
          </div>
        </section>

        <aside className="side-panel analyst-panel">
          <div className="section-kicker"><span>02 / COGNITIVE LAYER</span><Sparkles size={13} /></div>
          <div className="analyst-title"><BrainCircuit size={22} /><div><h1>MOBI AI ANALYST</h1><span>REAL-TIME INTELLIGENCE BRIEF</span></div></div>
          <div className="rule" />

          <div className="ai-status">
            <div><small>STATUS</small><strong className={brief?.generatedBy === 'mobi-ai' ? 'active' : 'fallback'}>{aiLoading ? 'ANALYZING' : brief?.generatedBy === 'mobi-ai' ? 'AI ACTIVE' : 'ANALYTICAL MODE'}</strong></div>
            <div><small>ASSESSMENT</small><strong>{brief?.assessment ?? 'PENDING'}</strong></div>
            <div><small>CONFIDENCE</small><strong>{brief ? `${brief.confidence}%` : '—'}</strong></div>
          </div>

          <div className="brief-card">
            <div className="brief-heading"><span>GLOBAL INTELLIGENCE BRIEF</span><button onClick={() => void loadBrief()} disabled={aiLoading} aria-label="Refresh AI brief"><RefreshCw size={12} className={aiLoading ? 'spin' : ''} /></button></div>
            <p>{brief?.summary ?? 'Collecting verified public data for the first analytical read-out.'}</p>
          </div>

          <div className="signal-stack">
            {(brief?.signals ?? []).map((signal, index) => (
              <article className={`ai-signal ${signal.level}`} key={`${signal.title}-${index}`}>
                <div><CircleDot size={12} /><strong>{signal.title}</strong><small>{signal.source}</small></div>
                <p>{signal.detail}</p>
              </article>
            ))}
          </div>

          <div className="model-note">
            <ShieldCheck size={13} />
            <span>{brief?.generatedBy === 'mobi-ai' ? `AI GENERATED · ${brief.model}` : 'RULE-BASED FALLBACK · NO MODEL CLAIM'}</span>
          </div>
          <p className="method-note">Public-source analysis. Observations and confidence are shown with their originating data source.</p>
        </aside>
      </section>

      <section className="telemetry-strip">
        <div className="strip-label"><Database size={15} /><span>LIVE TELEMETRY</span><small>VERIFIED SOURCES</small></div>
        {(data?.markets ?? []).map((market) => (
          <div className="metric market-metric" key={market.symbol}>
            <small>{market.symbol} / USD</small>
            <strong>{formatPrice(market)}</strong>
            <span className={(market.change ?? 0) >= 0 ? 'positive' : 'negative'}>{market.change === null ? '—' : `${market.change >= 0 ? '+' : ''}${market.change.toFixed(2)}%`}</span>
          </div>
        ))}
        <div className="metric"><small>EARTHQUAKES</small><strong>{data?.earthquakes.length ?? '—'}</strong><span>USGS M4.5+ / 24H</span></div>
        <div className="metric"><small>SPACE WEATHER</small><strong>{data?.spaceWeather ? `Kp ${data.spaceWeather.kp.toFixed(1)}` : '—'}</strong><span>{data?.spaceWeather?.level ?? 'AWAITING NOAA'}</span></div>
        <div className="metric"><small>ISS ORBIT</small><strong>{data?.iss ? `${data.iss.altitudeKm.toFixed(0)} KM` : '—'}</strong><span>{data?.iss ? `${Math.abs(data.iss.latitude).toFixed(1)}° ${data.iss.latitude >= 0 ? 'N' : 'S'}` : 'AWAITING POSITION'}</span></div>
      </section>

      <footer className="ticker-bar">
        <div className="ticker-id"><Orbit size={13} /> MD // INTEL</div>
        <div className="ticker-window"><div className="ticker-track"><span>{ticker}&nbsp;&nbsp;•&nbsp;&nbsp;</span><span aria-hidden="true">{ticker}&nbsp;&nbsp;•&nbsp;&nbsp;</span></div></div>
        <div className="sync-state"><TrendingUp size={12} /> {dataLoading ? 'SYNCING' : data ? `SYNC ${new Date(data.generatedAt).toISOString().slice(11, 19)} UTC` : 'WAITING'}</div>
      </footer>
    </main>
  );
}
