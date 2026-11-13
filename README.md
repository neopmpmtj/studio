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

The browser will ask for microphone access. Start a recording, stop it, and the take is stored. Length is in seconds; 0 records until Stop, and any other value stops on its own. Elapsed time shows beside the button. Every 30 seconds the take so far is written, and each later checkpoint replaces that same row, so a long recording is on disk before Stop. Recent recordings show start time and duration and open in Recordings. Labels are edited locally and written only when you press Save.

Recordings (`/recordings`) lists saved takes, plays a take, and deletes one or many. A click on a name opens that take. A double-click opens its edit page, the same place as Edit, when the take has an audio file. A double-click with Shift, Ctrl, or Alt stays on the list. A double-click on the open take whose file is already missing stays on the list. Speed, from 0.25x to 2x, sits beside the player. Download stays the link next to Edit. A take saved from now on draws its waveform. Older takes still draw the loudness trace. Last N shows only the newest takes. Paged walks the full list.

Edit (`/recordings/edit`) crops that take. Normal mode: drag to select, then Play or Remove; drag the edges to trim; Copy and Paste insert a section. Move fast applies the drag on release: Delete removes it, Play plays it, Select keeps it, and Zoom fits the view to it. Undo and Redo walk those edits. Save and Save as stay dimmed until the kept audio changes. Save rewrites the take in place. Save as asks where to write the copy, starting from `clips/audio/modified/<uuid>/<uuid>.wav`. A copy that already lives under that folder keeps its own path as the suggestion. The path has to be a `.wav` under `clips/audio/modified/`. A path already used by a row replaces that row. Copies already stored at `modified/clips/audio/<uuid>/<uuid>.wav` still play and delete.

Loudness gain, loudness window, and loudness smoothing are on `/controls`. A slider change applies immediately. The loudness graph reads gain and the time window every frame; smoothing is read every frame of a capture. These sliders do not change the waveform. Choosing a preset does not move the sliders. Reset applies the selected preset. Five built-ins ship with the app: Peaks, Speech, Music, Room, and Monitor. Save stores the current slider values under a name (max 20 saved presets, names trimmed to 40 characters). Built-ins cannot be removed.

```bash
npm run typecheck
```

## Layout

| Path | Role |
| --- | --- |
| `web/` | React + Vite UI. Studio page (waveform, live loudness graph, recent takes, labels), `/recordings`, `/recordings/edit`, and `/controls`. |
| `server/` | Fastify API and WebSocket. Persists settings, labels, presets, and entries. |
| `shared/` | Settings, presets, messages, and entry types (`types.ts`); kept spans (`crop.ts`); save-as paths (`clip-path.ts`). |

Settings flow over `/ws`. A change applies immediately in the tab that made it, is broadcast to other clients, and is written to the `kv` table. Values are clamped to the ranges in `shared/types.ts`.

## API

| Method | Path | |
| --- | --- | --- |
| `GET` | `/api/entries?limit=&offset=` | Page of recordings, newest first. `{ entries, total }`. `limit` defaults to 50 and maxes at 500. |
| `GET` | `/api/entries/:id` | One recording, including loudness samples and waveform peaks. Older rows have `waveform: null`. |
| `GET` | `/api/entries/:id/audio` | The wav. Supports byte ranges. |
| `POST` | `/api/entries` | Multipart: `meta` JSON (`startedAt`, `durationS`, `samples`, `waveform`, `uuid`) and an `audio` wav file. `waveform` is low/high pairs, one pair per 10 ms. Writes `clips/audio/<uuid>/<uuid>.wav`. |
| `PUT` | `/api/entries/:id` | Same multipart as `POST /api/entries`. Replaces the wav, duration, loudness, and waveform of that original take. The uuid must match the row. A modified copy is refused. |
| `POST` | `/api/entries/:id/crop` | `{ mode: "overwrite" \| "copy", keep: [{ start, end }], audioPath? }`. Cuts the wav and slices the stored loudness and waveform. `overwrite` ignores `audioPath`. `copy` writes `audioPath`, or `clips/audio/modified/<uuid>/<uuid>.wav` when it is omitted. The path must be a `.wav` under `clips/audio/modified/` and at most 240 characters. A path already used by a row replaces that row. |
| `DELETE` | `/api/entries/:id` | Delete one recording and its wav. |
| `POST` | `/api/entries/delete` | Delete up to 100 (`{ ids: number[] }`) and their wavs. |
| `GET` | `/api/lists` | Saved labels. |
| `PUT` | `/api/lists` | Replace labels (`{ labels: string[] }`, max 200). |
| `GET` | `/api/presets` | Five built-in presets, then any saved ones. |
| `POST` | `/api/presets` | Add `{ name, settings }`. An empty or duplicate name is rejected. |
| `DELETE` | `/api/presets/:id` | Remove a saved preset. A built-in id is refused. |
| `WS` | `/ws` | Settings sync. Server sends `init`; clients send `patch`. |
