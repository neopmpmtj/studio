# Science Studio

Local microphone recorder. The browser measures loudness from the mic, draws it live, and saves each take to Postgres. Loudness gain, loudness window, and loudness smoothing stay in sync across open tabs.

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

The browser will ask for microphone access. Start a recording, stop it, and the take is stored. Recent recordings show start time and duration and open in Recordings. Labels are edited locally and written only when you press Save.

Recordings (`/recordings`) lists saved takes, plays a take, and deletes one or many. Edit opens a crop page for that take. Save rewrites it in place. Save as writes the same folders and filename under `modified/`, so `clips/audio/<uuid>/<uuid>.wav` becomes `modified/clips/audio/<uuid>/<uuid>.wav`. A take saved from now on draws its waveform. Older takes still draw the loudness trace. Last N shows only the newest takes. Paged walks the full list.

Loudness gain, loudness window, and loudness smoothing are on `/controls`. A slider change applies immediately. The loudness graph reads gain and the time window every frame; smoothing is read every frame of a capture. These sliders do not change the waveform. Choosing a preset does not move the sliders. Reset applies the selected preset. Five built-ins ship with the app: Peaks, Speech, Music, Room, and Monitor. Save stores the current slider values under a name (max 20 saved presets, names trimmed to 40 characters). Built-ins cannot be removed.

```bash
npm run typecheck
```

## Layout

| Path | Role |
| --- | --- |
| `web/` | React + Vite UI. Studio page (waveform, live loudness graph, recent takes, labels), `/recordings`, and `/controls`. |
| `server/` | Fastify API and WebSocket. Persists settings, labels, presets, and entries. |
| `shared/types.ts` | Settings, presets, messages, and entry types used by both sides. |

Settings flow over `/ws`. A change applies immediately in the tab that made it, is broadcast to other clients, and is written to the `kv` table. Values are clamped to the ranges in `shared/types.ts`.

## API

| Method | Path | |
| --- | --- | --- |
| `GET` | `/api/entries?limit=&offset=` | Page of recordings, newest first. `{ entries, total }`. `limit` defaults to 50 and maxes at 500. |
| `GET` | `/api/entries/:id` | One recording, including loudness samples and waveform peaks. Older rows have `waveform: null`. |
| `GET` | `/api/entries/:id/audio` | The wav. Supports byte ranges. |
| `POST` | `/api/entries` | Multipart: `meta` JSON (`startedAt`, `durationS`, `samples`, `waveform`, `uuid`) and an `audio` wav file. `waveform` is low/high pairs, one pair per 10 ms. |
| `POST` | `/api/entries/:id/crop` | `{ mode: "overwrite" \| "copy", keep: [{ start, end }] }`. Cuts the wav and slices the stored loudness and waveform. |
| `DELETE` | `/api/entries/:id` | Delete one recording and its wav. |
| `POST` | `/api/entries/delete` | Delete up to 100 (`{ ids: number[] }`) and their wavs. |
| `GET` | `/api/lists` | Saved labels. |
| `PUT` | `/api/lists` | Replace labels (`{ labels: string[] }`, max 200). |
| `GET` | `/api/presets` | Five built-in presets, then any saved ones. |
| `POST` | `/api/presets` | Add `{ name, settings }`. An empty or duplicate name is rejected. |
| `DELETE` | `/api/presets/:id` | Remove a saved preset. A built-in id is refused. |
| `WS` | `/ws` | Settings sync. Server sends `init`; clients send `patch`. |
