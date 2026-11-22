# VIDYASPHERE: MASTER ARCHITECTURE & EXPANDED DEVELOPMENT PLAN

> **Project Name:** VidyaSphere (*Vidya* = Supreme Knowledge + *Sphere* = Global Edge Ecosystem)  
> **Target Platform:** Cloudflare Workers, Durable Objects, D1, R2, and Cloudflare Pages  
> **Development Environment:** Termux (Android aarch64)  
> **Developer Resource Constraints:** Strict 1GB/day mobile data limit, zero heavy packages, zero Docker dependency  
> **Version:** 2.1 (Expanded Major Phases – Full School Core in Phase 1)

---

## 1. ARCHITECTURAL OVERVIEW & PRINCIPLES

1. **Phase 1 as a Complete School Workhorse:** Phase 1 is not just basic registration—it delivers an end-to-end, functional School Management Portal (Student Roster, Admin Approvals, Role-Based Access, Class/Division Tracking, Password Setup via Activation Codes, and Official School Notice Board/Announcements).
2. **Phase 2 as Academic Content Hub:** High-performance study notes repository backed by Cloudflare R2 object storage with fast indexed filtering (Class, Subject, Chapter) and download metrics.
3. **Phase 3 as Student Engagement & Governance:** Academic Q&A forum with accepted solutions, combined with a duplicate-proof Student Election & School Polling system.
4. **Phases 4-6 (Future Realtime & Edge Deployment):** High-concurrency native WebSocket chat, presence, PWA offline caching, and small-school production pilot.
5. **Zero External Runtime Packages:** Pure Native Web APIs (`Request`, `Response`, `fetch`, `crypto.subtle`, `WebSocketPair`).
6. **Zero-CLI Client Delivery:** Tailwind CSS and Lucide Icons loaded strictly via direct browser CDNs for instant loading and 0 Termux data consumption.

---

## 2. TECHNOLOGY MATRIX

| Layer | Technology | Delivery / Runtime Mechanism |
| :--- | :--- | :--- |
| **Frontend UI** | HTML5, CSS3, Vanilla JS (ES Modules) | Static files deployed to Cloudflare Pages (`client/`) |
| **Styling** | Tailwind CSS CDN | `<script src="https://cdn.tailwindcss.com"></script>` (No CLI) |
| **Icons** | Lucide Icons CDN | `<script src="https://unpkg.com/lucide@latest"></script>` (No CLI) |
| **Backend API** | Cloudflare Workers | Pure ES Modules (`worker/index.js`), 0 npm runtime packages |
| **Database** | Cloudflare D1 (SQLite) | Serverless relational edge database with local SQLite support |
| **Storage** | Cloudflare R2 | S3-compatible, zero-egress object storage for PDFs/images |
| **Realtime Engine** | Durable Objects + SQLite | WebSocket Hibernation for Phase 4 chat |
| **Dev Tool** | Wrangler CLI (`4.166.0`) | Pre-installed globally; runs dev server and local D1 |

---

## 3. MAJOR PHASE BREAKDOWN (EXECUTION ROADMAP)

### 🏫 PHASE 1: COMPLETE SCHOOL FOUNDATION & ADMIN CORE (MAJOR)
*Goal: Enable the school to completely manage student onboarding, rosters, and official communication immediately.*

1. **Database Schema (D1):**
   * `profiles`: User accounts (id, username, password_hash, full_name, class_name, division, roll_number, role, account_status, created_at).
   * `registrations`: Student application queue (tracking_token, school details, review_status, review_reason, timestamps).
   * `activation_codes`: High-entropy one-time codes (stored as SHA-256 hashes with expiry) for secure initial account claiming without SMTP email.
   * `announcements`: Official school notice board (title, content, priority, target_class, author_id, is_pinned, created_at).
   * `audit_logs`: Administrative actions tracking.
2. **Security & Cryptography (`worker/auth/crypto.js`):**
   * Pure `crypto.subtle` PBKDF2 password hashing with cryptographically secure random salts.
   * High-entropy tracking tokens & 6-digit alphanumeric activation codes.
   * Stateless, cryptographically signed Bearer Tokens (HMAC-SHA256 JWT) with role claims (`student`, `teacher`, `admin`).
3. **Backend Endpoints (`worker/`):**
   * Student Registration: `POST /api/auth/register` (Stores pending application, returns tracking token).
   * Student Status Check: `GET /api/auth/status?token=...` (Shows pending/approved/rejected status + displays activation code if approved).
   * Account Activation: `POST /api/auth/activate` (Verifies hashed activation code, accepts student-selected password, creates active profile).
   * Student & Admin Login: `POST /api/auth/login` (Validates password hash, returns JWT session).
   * Profile Management: `GET /api/auth/me`, `PUT /api/auth/change-password`.
   * School Notice Board: `GET /api/announcements` (Filter by class or school-wide), `POST /api/admin/announcements` (Create/Pin notices).
   * School Admin Roster Operations:
     * `GET /api/admin/registrations` (Filter pending, approved, rejected).
     * `POST /api/admin/approve` (Issues unique username & activation code).
     * `POST /api/admin/reject` (Records reason for correction/rejection).
     * `GET /api/admin/students` (Search student roster by class, division, roll number).
     * `POST /api/admin/student-status` (Suspend or activate student).
4. **Frontend Interfaces (`client/`):**
   * Responsive Navigation: Mobile bottom bar + Desktop sidebar.
   * Student Application Page (`client/auth/register.html`): Form validation, clean error handling, tracking token bookmark notification.
   * Status & Account Claim Page (`client/auth/status.html`): Real-time lookup with saved local token, one-click password setup upon approval.
   * Unified Login (`client/auth/login.html`): Clean modern UI for both students and school staff.
   * School Hub & Notice Board (`client/dashboard/index.html`): Announcements feed with priority badges (Urgent, Exam, Holiday), school calendar overview.
   * Student Directory & Roster Viewer (`client/dashboard/students.html`).
   * Complete Admin Portal (`client/admin/index.html`): Approval queue with one-click actions, student management table, notice board creator.

---

### 📚 PHASE 2: ACADEMIC NOTES & STUDY MATERIAL LIBRARY (MAJOR)
*Goal: Provide a full digital library where students and teachers share, search, and download verified study materials.*

1. **Database Schema (D1):**
   * `notes`: Academic files catalog (uploader_id, title, description, class_name, subject, chapter, r2_key, file_type, file_size, moderation_status, download_count, created_at).
   * `note_reports`: Student reporting mechanism for incorrect or corrupted files.
2. **Object Storage Engine (`worker/routes/notes.js`):**
   * Cloudflare R2 bucket integration (`STORAGE`).
   * Multi-part or streaming upload validation: enforces allowed MIME types (PDF, JPEG, PNG) and max size limits (15 MB).
   * Direct streaming download with cached headers and atomic `download_count` increment in D1.
3. **Backend Endpoints:**
   * `POST /api/notes/upload` (Upload note file to R2 + insert metadata in D1).
   * `GET /api/notes` (Search notes by title/chapter; filter by class, division, subject; sort by newest or most downloaded).
   * `GET /api/notes/:id/file` (Stream file from R2).
   * `DELETE /api/notes/:id` (Uploader or Admin deletion; deletes from R2 and D1).
   * `POST /api/notes/:id/report` (Student report for bad content).
4. **Frontend Interfaces (`client/dashboard/notes.html`):**
   * Search-first header with live text filtering.
   * Multi-dropdown filter pills (Class, Subject, Chapter).
   * Note cards with file type badges (PDF/IMG), size indicator, uploader details, and download counter.
   * Drag-and-drop / mobile file picker upload modal with upload progress indicator.
   * Notes moderation tab in the Admin portal.

---

### 🗳️ PHASE 3: ACADEMIC Q&A FORUM & SCHOOL POLLS / ELECTIONS (MAJOR)
*Goal: Peer-to-peer homework help and school democracy via polls with duplicate-vote prevention.*

1. **Database Schema (D1):**
   * `questions`: Forum threads (author_id, title, description, subject, class_name, is_resolved, created_at).
   * `answers`: Thread responses (question_id, author_id, answer_text, is_accepted, created_at).
   * `polls`: School voting topics (creator_id, question, options_json, expires_at, created_at).
   * `poll_votes`: Atomic vote ledger with `UNIQUE(poll_id, user_id)` constraint to mathematically forbid multi-voting.
2. **Backend Endpoints:**
   * `POST /api/qa/questions` & `GET /api/qa/questions` (Filter by subject, class, resolved vs unanswered).
   * `POST /api/qa/questions/:id/answers` (Submit answer).
   * `POST /api/qa/answers/:id/accept` (Question author marks answer as accepted solution).
   * `POST /api/polls` (Create poll with multiple options and expiration date).
   * `GET /api/polls` (Fetch active/closed polls with computed live vote tallies and user vote status).
   * `POST /api/polls/:id/vote` (Cast vote with strict conflict resolution).
3. **Frontend Interfaces:**
   * Q&A Forum (`client/dashboard/qa.html`): Question list, search, rich detail view, answer submission box, and "Mark Accepted" button with green solution banner.
   * School Polls (`client/dashboard/polls.html`): Visual voting cards, animated percentage progress bars upon voting, countdown to expiration, creator metadata.

---

### 💬 PHASES 4-6: REALTIME CHAT, PWA & DEPLOYMENT (FUTURE)
* To be planned and executed immediately after Phases 1-3 validation:
  * Phase 4: Cloudflare Durable Objects + Native WebSocketPair + Hibernation for Public & Private Realtime Chat.
  * Phase 5: Service Worker offline caching, PWA installation manifest, In-app push notifications.
  * Phase 6: Cloudflare Pages & Worker production deployment.
