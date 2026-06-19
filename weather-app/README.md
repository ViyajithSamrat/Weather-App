# Vertex Weather

Apple Weather inspired web app integrating OpenWeather APIs with an interactive
MapLibre GL map (OpenFreeMap base + OpenWeather raster layers) to deliver
real-time forecasts and location search — no Mapbox account required.

<img width="3976" height="2534" alt="CleanShot 2026-03-05 at 21 05 44@2x" src="https://github.com/user-attachments/assets/3cfcb021-b7cd-4995-b022-ef30aef3ac4c" />

## Features

- **Weather overview** — Current conditions, hourly and 10-day forecasts, and detailed metrics (air quality, UV, wind, pressure, precipitation, humidity, visibility, sunrise/sunset).
- **Interactive map** — MapLibre GL renders OpenFreeMap base tiles and overlays OpenWeather layers (clouds, precipitation, pressure, wind, temperature).
- **Locations** — Search cities via the OpenWeather Geocoding API (proxied server-side). Saved locations are stored in **localStorage**.
- **Theme** — Light / dark / system (next-themes).

## Tech Stack

- **Framework** — Next.js 16, React 19
- **UI & styling** — Tailwind CSS, Base UI / shadcn, Lucide, tailwind-merge, class-variance-authority
- **Animation** — Motion
- **State** — Zustand
- **Maps** — MapLibre GL (open-source, MIT) + OpenFreeMap (free, no key, no account)
- **Data** — OpenWeather API (current, forecast, geocoding, air pollution, tile overlays)
- **Utils** — date-fns

## Data fetching

**OpenWeather:** The app uses several OpenWeather endpoints (current weather, 3-hour
forecast aggregated into hourly + daily summaries, air pollution). The free tier is
sufficient — the app does not call the paid One Call API.

- **Weather data** — Fetched on the server via [Next.js Server Actions](https://nextjs.org/docs/app/building-your-application/data-fetching/server-actions-and-mutations) (`actions/weather.ts`). Current, hourly, daily, air pollution, and UV are requested in parallel with `Promise.all` and cached with `next: { revalidate: 1800 }` (30 minutes).
- **Map tiles** — Served through a Next.js API route (`/api/weather/[layer]/[z]/[x]/[y]`) that proxies to OpenWeather's tile API. The route keeps `OPENWEATHER_API_KEY` on the server.
- **Location search** — The browser hits an internal route (`/api/geocode`) that proxies to the OpenWeather Geocoding API server-side. The API key never reaches the client.

## Getting Started

First, create a `.env.local` file and add the single required variable:

```
OPENWEATHER_API_KEY=your_openweather_api_key
```

Then, install dependencies:

```bash
npm install
# or
yarn install
# or
pnpm install
# or
bun install
```

Finally, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result. The app defaults to Cupertino, CA. Use the sidebar to search and change locations.
