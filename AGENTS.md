# AGENTS.md — Operational Rules & Constraints for AI Agents

> **Project:** VidyaSphere (Supreme Knowledge Edge Ecosystem)  
> **Target Platform:** Cloudflare Workers, Cloudflare D1 (SQLite), Cloudflare R2 / Compressed BLOBs, Cloudflare Static Assets  
> **Execution Environment:** Termux on Android (aarch64 Mobile Device)  
> **Primary Rule:** Strict Data Conservation & Zero-Bloat Architecture  

---

## 🚨 ABSOLUTE GUARDRAILS & "NEVER" RULES

### 1. 1GB/Day Mobile Data Cap (STRICTEST CONSTRAINT)
* **NEVER run `npm install`, `pnpm add`, `yarn`, or download any packages.** Every byte of mobile data is precious (1GB/day limit for the entire device).
* **NEVER install or run Docker, heavy compilers, or multi-megabyte binaries.**
* **NEVER install frontend build frameworks (Vite, Webpack, Next.js, PostCSS CLI, Tailwind CLI).**
* **NEVER make unnecessary bulk curl/wget downloads** or run repetitive high-bandwidth network queries.

### 2. Client-Side CDN-Only Rule
* The `client/` folder is 100% Vanilla HTML5, CSS3, and ES Modules (`<script type="module">`).
* **External libraries are permitted ONLY via direct browser CDN `<script>` or `<link>` tags** inside HTML:
  - Tailwind CSS: `<script src="https://cdn.tailwindcss.com"></script>`
  - Lucide Icons: `<script src="https://unpkg.com/lucide@latest"></script>`
* No bundlers, no compilation steps, zero client node_modules.

### 3. Backend Zero-NPM Rule
* `worker/` runs purely on Native Web APIs available in Cloudflare Workers and Node.js:
  - `fetch`, `Request`, `Response`, `Headers`, `URL`, `FormData`
  - `crypto.subtle` for PBKDF2 hashing, HMAC-SHA256 tokens, SHA-256 digests
  - `CompressionStream('gzip')` and `DecompressionStream('gzip')` for in-memory file compression
  - `WebSocketPair` for realtime chat
* No runtime npm packages may ever be added to `package.json` or imported in `worker/`.

### 4. Git Branch Isolation & Preview-First Deployment (MANDATORY RULE)
* **NEVER code or commit directly on `master` or `main`.** Always create and switch to a new branch first: `git checkout -b <branch-name>`.
* **NEVER deploy directly to Main Production (`wrangler deploy`) without user approval.**
* **MANDATORY 4-STEP CYCLE FOR EVERY UPDATE:**
  1. **New Branch:** Create and checkout a feature/task branch (`git checkout -b feature/<name>`).
  2. **Local Verification:** Perform surgical changes and verify with `node test.js` (Must be 100% PASS).
  3. **Experimental Deploy:** Deploy ONLY to the experimental/preview URL using `wrangler deploy --env preview`. Share the experimental preview URL with the user.
  4. **Main Production Gate:** Deploy to main production (`wrangler deploy` on `master`) ONLY after the user explicitly verifies and commands: *"main me karo"*.

---

## ⚡ COMMAND-FIRST REFERENCE

All commands must be executed from the project root (`/data/data/com.termux/files/home/VidyaSphere`):

| Purpose | Command | Notes |
| :--- | :--- | :--- |
| **Local Dev Server** | `node dev.js` | Uses Node.js native `DatabaseSync` (`node:sqlite`) on port 8787. Avoids `workerd EPIPE` Termux crash. |
| **Automated Tests** | `node test.js` | Runs full master verification suite in-memory. Must PASS 100% before any task is complete. |
| **Experimental / Preview Deploy** | `wrangler deploy --env preview` | Deploys to isolated preview worker (`vidyasphere-preview`). Main URL is NEVER touched. |
| **Main Production Deploy** | `wrangler deploy` | ONLY executed when user explicitly approves promoting to main. |
| **D1 Remote Schema** | `wrangler d1 execute vidyasphere-db --remote --file=./schema.sql` | Updates remote production schema when database structure changes. |
| **D1 Remote Query** | `wrangler d1 execute vidyasphere-db --remote --command="SELECT COUNT(*) FROM profiles"` | Runs ad-hoc read/maintenance query on Cloudflare D1. |
| **Cloudflare Tail Logs** | `wrangler tail` | Streams live production Worker logs. |

---

## 🌐 CLOUDFLARE HOSTING & PRODUCTION WORKFLOW

* **Live Status:** This project is already live and hosted on Cloudflare Workers and Cloudflare D1.
* **Wrangler CLI:** Pre-installed globally in Termux. AI agents must use `wrangler` commands directly for deployment, D1 maintenance, and secrets configuration.
* **Continuous Updates (Strict 4-Step Cycle):**
  1. **Branch First:** Always create a new branch: `git checkout -b <branch-name>`.
  2. **Minimal Edits & Local Tests:** Make minimal surgical edits and run `node test.js` until 100% PASS.
  3. **Experimental Deploy:** Deploy to preview environment via `wrangler deploy --env preview` and provide the experimental URL to user.
  4. **Production Deploy (Approval Gate):** NEVER deploy to main unless the user explicitly reviews and commands *"main me karo"*. When approved, merge branch to `master` and run `wrangler deploy`.
  5. If database schema was altered, apply it remotely via `wrangler d1 execute vidyasphere-db --remote --file=./schema.sql`.

---

## 🏛️ ARCHITECTURAL CONVENTIONS

### 1. Database & State (Cloudflare D1 / SQLite)
* Use pure SQLite compatible SQL.
* Store tables with `IF NOT EXISTS`.
* For foreign keys, enforce cascading or indexing where queries join frequently.
* Passwords must ALWAYS be hashed using PBKDF2 (`worker/auth/crypto.js`) with 20,000 iterations and random salts. Plaintext passwords must NEVER be logged or stored.

### 2. High-Entropy Session Auth
* Sessions are stored in the `sessions` table with 256-bit secure tokens (`vss_...`).
* Bearer tokens are validated against the database in `worker/auth/middleware.js`.
* Admin immunity is enforced: Secondary admins cannot suspend or demote the Lead Root Admin (`@admin`).

### 3. In-Database BLOB Chunking for Notes
* Study notes are stored in `notes` and binary chunks in `note_files`.
* Files are compressed via `CompressionStream('gzip')` before saving chunks to reduce storage by 40-60%.
* Permanent Google Drive links are supported as zero-storage alternatives for large syllabus files.

---

## 💬 USER COMMUNICATION GUIDELINES

* **Language:** Respond in clear, friendly, and natural **Hinglish** (Hindi + English mixed in Latin script) as requested by the user.
* **Tone:** Respectful, practical, proactive, and conscious of mobile device constraints (battery, 1GB data limit, Termux CPU).
* **Clickable Links:** Always provide clickable Markdown links `[filename](file:///path/to/file)` for every file referenced or updated.
* **Verification:** Always confirm tests pass (`node test.js`) before telling the user the work is done.
