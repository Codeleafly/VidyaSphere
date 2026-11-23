# 🎓 VidyaSphere — Supreme Knowledge Edge Ecosystem

> **Vidya** (*Supreme Knowledge*) + **Sphere** (*Global Edge Ecosystem*)  
> A high-speed, distraction-free digital ecosystem for school administration, academic notes, student democracy, and realtime collaboration.

[![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare&logoColor=white)](https://workers.cloudflare.com/)
[![Cloudflare D1](https://img.shields.io/badge/Database-Cloudflare_D1_(SQLite)-blue)](https://developers.cloudflare.com/d1/)
[![Zero Dependencies](https://img.shields.io/badge/Runtime_npm-0_Packages-brightgreen)](#-zero-npm-architecture)
[![Mobile Data Optimized](https://img.shields.io/badge/Termux_Ready-100%25-blueviolet)](#-mobile-first--termux-native)

---

## 🌟 Key Features

1. **🏫 Instant Student Onboarding & Admin Core**
   - Direct registration with user-selected password and 1-click admin approval queue.
   - Lead Root Admin hierarchy with immunity against sub-admin privilege escalations.
   - Official School Notice Board with priority badges (*Urgent*, *Exam*, *Holiday*, *General*).

2. **📚 Academic Notes & Study Material Library**
   - In-database gzip-compressed BLOB chunking (`CompressionStream('gzip')`) shrinking PDFs by 40-60%.
   - Support for zero-storage permanent Google Drive links for large syllabus files.
   - Indexed filtering by Class (Class 1 to 12), Subject, and Chapter with atomic download tracking.

3. **📅 Official Examination Timetables & Schedules**
   - Admin-only exam scheduler with auto-notice broadcast to the school notice board.
   - Class-specific datesheets, timings, room/hall numbers, and downloadable syllabus links.

4. **🗳️ Duplicate-Proof School Polls & Elections**
   - Student democracy ledger backed by `UNIQUE(poll_id, user_id)` database constraints to mathematically prevent multi-voting.
   - Realtime animated percentage bars and live vote counts.

5. **❓ Academic Q&A Discussion Forum**
   - Peer-to-peer homework help with verified **Accepted Solution** marking by question authors.

6. **💬 Native Realtime Class Chat**
   - Built on Cloudflare `WebSocketPair` with instant edge broadcasting and REST messaging fallback.

---

## 🏛️ Zero-NPM Architecture

VidyaSphere is engineered with **0 runtime npm packages**:
- **Backend (`worker/`)**: 100% Native Web Standards (`Request`, `Response`, `fetch`, `crypto.subtle`, `WebSocketPair`, `CompressionStream`).
- **Frontend (`client/`)**: Pure Vanilla HTML5, CSS3, and ES Modules (`<script type="module">`). UI styling and icons are loaded strictly via direct browser CDNs (Tailwind CSS CDN and Lucide Icons CDN).
- **Zero Build Step**: No Vite, no Webpack, no node_modules footprint.

---

## ⚡ Quick Start & Development

### Prerequisites
- Node.js (v18+ or v22+)
- (Optional) Wrangler CLI for Cloudflare deployments

### Run Local Development Server
```bash
# Starts native Node.js HTTP + SQLite server on port 8787
node dev.js
```
Open your browser at `http://localhost:8787` (or `http://<phone-ip>:8787` on your local network).

### Run Master Verification Suite
```bash
node test.js
```
Runs 21 automated end-to-end integration tests in-memory.

---

## 🚀 Cloudflare Deployment

### Option 1: Automatic via GitHub Actions
Pushing to `main` or `master` triggers the included GitHub Actions workflow (`.github/workflows/deploy.yml`).
Make sure to add the following secrets in your GitHub repository settings:
- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

### Option 2: Cloudflare Dashboard Git Integration
In Cloudflare Dashboard:
1. Navigate to **Workers & Pages** &gt; Select **vidyasphere**.
2. Go to **Settings** &gt; **Builds & deployments**.
3. Connect your GitHub repository (`Codeleafly/VidyaSphere`).
4. Set build command to empty (no build needed!) and deploy branch to `master`.

### Option 3: Manual Deployment via Wrangler CLI
```bash
wrangler deploy
```

---

## 📄 License
Academic & School Educational Use &bull; Created with pride for VidyaSphere.
