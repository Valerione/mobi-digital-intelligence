# MOBI.DIGITAL // Global Intelligence

An online situational-awareness dashboard for MOBI.DIGITAL. The beta combines attributed public data sources, a WebGL globe, and **MOBI AI ANALYST**.

## Live sources

- USGS earthquakes
- NASA EONET natural events
- NOAA SWPC planetary K index
- Where the ISS at position data
- CoinGecko BTC and ETH market data
- Frankfurter EUR/USD reference rates

A failed source is marked `STALE` or `OFFLINE`; it is never silently replaced with invented data.

## AI analyst

On Netlify, the `/api/ai/brief` route uses Netlify AI Gateway when available. The browser never receives provider credentials. Without an AI Gateway or model key, the interface explicitly switches to `RULE-BASED FALLBACK / NO MODEL CLAIM` and produces a deterministic read-out from the live snapshot.

The AI route accepts no user prompt. It summarizes only the server-side public-data snapshot and caches the result for 15 minutes to control cost.

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Netlify

The repository includes `netlify.toml`. Connect the GitHub repository to Netlify and deploy; Netlify applies its OpenNext adapter automatically. The first production deployment enables AI Gateway for the project when AI features are enabled for the team.

Optional environment variable:

```text
MOBI_AI_MODEL=gpt-5-nano
```

## Privacy and security

- No analytics or visitor tracking
- No cookies
- No local storage
- No client-side secrets
- No reconnaissance or vulnerability-scanning endpoints
- Read-only upstream requests
- CSP and restrictive browser permissions headers

## Attribution

This project was derived from [simplifaisoul/osiris](https://github.com/simplifaisoul/osiris) and remains subject to the included MIT license and copyright notice. MOBI.DIGITAL’s interface, source aggregation, privacy changes, and AI analyst workflow are custom adaptations.
