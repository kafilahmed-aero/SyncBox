# SyncBox

> Synchronized Multi-Device Speaker System (Web Application)

## Current Status: Phase 7 — Drift Detection & Correction (Complete)

SyncBox turns ordinary devices — laptops, phones, and tablets — into a synchronized multi-device speaker system.

This repository currently contains **Frontend Phase 1–5 (Complete)**, **Backend Phase 1–4 (Complete)**, **Phase 6 Clock Synchronization & Synchronized Initial Playback Start (Complete)**, and **Phase 7 Drift Detection / Correction (Complete)**.

### What Currently Works

#### Client-Centric Drift Detection & Correction (Phase 7)
- **Measurement Loop**: Evaluates device playback position every **3 seconds** (`3000ms`) while `playbackState === 'PLAYING'`.
- **Expected Position Math**:
  $$\text{ExpectedPosition} = \text{lastPlaybackPosition} + \frac{\text{clockSync.getServerTime}() - \text{lastCommandTimestamp}}{1000}$$
  $$\text{driftMs} = (\text{audioEngine.getCurrentPosition}() - \text{ExpectedPosition}) \times 1000$$
- **Drift Classification & Actions**:
  - **In Sync ($|\text{driftMs}| \le 20\text{ms}$)**: `setPlaybackRate(1.000)`.
  - **Soft Correction ($20\text{ms} < |\text{driftMs}| \le 200\text{ms}$)**:
    - Client Ahead ($\text{driftMs} > 0$): `setPlaybackRate(0.995)`.
    - Client Behind ($\text{driftMs} < 0$): `setPlaybackRate(1.005)`.
    - Restores `setPlaybackRate(1.000)` once $|\text{driftMs}| \le 10\text{ms}$.
  - **Hard Resynchronization ($|\text{driftMs}| > 200\text{ms}$)**: Re-triggers `audioEngine.playScheduled(targetCtxTime, expectedPosition)` at current timeline position without restarting song.
- **State Isolation**: Drift loop runs strictly during active `PLAYING` state. Automatically disabled when `PAUSED` or `STOPPED`.
- **UI Diagnostics**: Header badge displays real-time offset, RTT, drift, and playback rate (`Drift: +12ms • Rate 1.000x`).

#### Synchronized Initial Playback Start (Phase 6)
- `CMD_PLAY` calculates `playAtTimestamp = serverTime + 1000ms`.
- `clockSync.toAudioContextTime(playAtTimestamp, audioCtx)` converts server target to local `AudioContext.currentTime` timeline.
- `AudioEngine.playScheduled()` schedules Web Audio API hardware start via `sourceNode.start()`.

#### Clock Synchronization Engine (Phase 5/6)
- NTP-style 4-timestamp exchange ($t_1, t_2, t_3, t_4$) over `SYNC_REQUEST`.
- Lowest-RTT sample filtering & 15-second periodic auto-sync.

#### Frontend & Backend Features (Phase 1–5 & Backend Phase 1–4)
- Real Socket.IO connection on `http://localhost:4000`, `CREATE_ROOM`, `JOIN_ROOM`, `DEVICE_UPDATE` broadcasts.
- HTTP audio upload (`POST /upload-audio`), temporary disk storage in `backend/uploads/`, Socket.IO `SONG_SELECTED` metadata broadcast, HTTP audio download (`GET /audio/:songId`), and `AUDIO_READY` readiness tracking.

---

## Installation & Local Development

### Prerequisites
- Node.js (v18+ recommended)
- npm

### 1. Frontend Setup & Startup
```bash
cd frontend
npm install
npm run dev
```
Access Frontend at: `http://localhost:3000`

### 2. Backend Setup & Startup
```bash
cd backend
npm install
npm run dev
```
Access Backend at: `http://localhost:4000`  
Health Endpoint: `http://localhost:4000/health`  
Test Suite: `npm test`

---

## Repository Structure
```text
musicsync/
├── frontend/
│   ├── public/
│   ├── src/
│   │   ├── audio/
│   │   │   ├── AudioEngine.js          # Web Audio API AudioContext, AudioBuffer, playScheduled & setPlaybackRate
│   │   │   └── ClockSync.js            # Client-Server Clock Synchronization Engine
│   │   ├── components/
│   │   ├── pages/
│   │   ├── socket.js                   # Shared Socket.IO client instance
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── index.html
│   ├── vite.config.js
│   └── package.json
├── backend/
│   ├── src/
│   │   ├── RoomManager.js              # In-memory rooms, device & playback state management
│   │   └── audioHandler.js             # HTTP audio upload & download routes
│   ├── test/
│   │   ├── test_rooms.js               # Rooms & sockets integration test
│   │   ├── test_audio.js               # Audio upload & distribution test
│   │   ├── test_clock_sync.js          # Clock sync 4-timestamp exchange test
│   │   ├── test_playback_commands.js   # Host playback commands integration test
│   │   ├── test_synchronized_playback.js # Synchronized scheduled initial start test
│   │   └── test_drift_correction.js    # Phase 7 drift calculations & rate corrections test
│   ├── uploads/                        # Temporary audio disk storage
│   ├── server.js                       # Express, Socket.IO & CORS server
│   └── package.json
└── README.md
```
