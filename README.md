# Science Studio

Local microphone recorder. The browser measures loudness from the mic, draws it live, and saves each take to Postgres. Gain, time window, and smoothing stay in sync across open tabs.

## Requirements

- Node.js (current LTS or newer)
- PostgreSQL, reachable from this machine

## Setup

```bash
npm install
```

Create the database and a role that can connect to it, then put the connection string in `server/.env`:

```
DATABASE_URL=postgres://USER:PASSWORD@localhost:5432/studio
PORT=3001
```

`PORT` is optional and defaults to `3001`. Tables are created on server startup (`kv` for settings, labels, and presets, `entries` for recordings).

## Run

```bash
npm run dev
```

- Web UI: http://127.0.0.1:5173 (Vite proxies `/api` and `/ws` to the server)
- API: http://127.0.0.1:3001

The browser will ask for microphone access. Start a recording, stop it, and the take is stored. Recent recordings show start time and duration. Labels are edited locally and written only when you press Save.

Gain, time window, and smoothing are on `/controls`. A slider change applies immediately. The loudness graph reads gain and the time window every frame; smoothing is read every frame of a capture. Choosing a preset does not move the sliders. Reset applies the selected preset. Five built-ins ship with the app: Peaks, Speech, Music, Room, and Monitor. Save stores the current slider values under a name (max 20 saved presets, names trimmed to 40 characters). Built-ins cannot be removed.

```bash
npm run typecheck
```

## Layout

| Path | Role |
| --- | --- |
| `web/` | React + Vite UI. Studio page (waveform, live loudness graph, recordings, labels) and `/controls`. |
| `server/` | Fastify API and WebSocket. Persists settings, labels, presets, and entries. |
| `shared/types.ts` | Settings, presets, messages, and entry types used by both sides. |

Settings flow over `/ws`. A change applies immediately in the tab that made it, is broadcast to other clients, and is written to the `kv` table. Values are clamped to the ranges in `shared/types.ts`.

## API

| Method | Path | |
| --- | --- | --- |
| `GET` | `/api/entries` | Latest 50 recordings (id, start, duration). |
| `GET` | `/api/entries/:id` | One recording, including samples. |
| `POST` | `/api/entries` | Multipart: `meta` JSON (`startedAt`, `durationS`, `samples`, `uuid`) and an `audio` wav file. |
| `GET` | `/api/lists` | Saved labels. |
| `PUT` | `/api/lists` | Replace labels (`{ labels: string[] }`, max 200). |
| `GET` | `/api/presets` | Five built-in presets, then any saved ones. |
| `POST` | `/api/presets` | Add `{ name, settings }`. An empty or duplicate name is rejected. |
| `DELETE` | `/api/presets/:id` | Remove a saved preset. A built-in id is refused. |
| `WS` | `/ws` | Settings sync. Server sends `init`; clients send `patch`. |
