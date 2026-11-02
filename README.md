# Shared Bill Splitter

Repository: [https://github.com/saitharun1604/shared-bill-splitter.git](https://github.com/saitharun1604/shared-bill-splitter.git)

A safe, correct, and fully typed bill splitter for shared households built with **Hono on Cloudflare Workers**, **Cloudflare D1 (SQLite)**, **React 19**, and **TanStack Router**.

---

## Architecture Overview

This project is structured as a **pnpm monorepo workspace** with strict separation of concerns between API and client:

```
shared-bill-splitter/
├── api/                  # Cloudflare Workers API (Hono)
│   ├── migrations/       # D1 SQLite migration files (0001_init.sql)
│   ├── src/
│   │   └── index.ts      # Hono application routes and business logic
│   └── test/             # Vitest test suite running in Workers runtime
├── web/                  # Frontend Single Page App (React 19 + TanStack Router)
│   └── src/
│       ├── routes/       # File-based routes (index.tsx)
│       └── main.tsx      # App bootstrap and router provider
├── biome.json            # Code formatting and linting configuration
└── package.json          # Root workspace scripts and tooling
```

### Data Flow

1. **Client / Web UI**: The React interface interacts with the backend via `/api/*` endpoints (proxied locally through Vite to `http://127.0.0.1:8787`).
2. **API Layer**: Hono router validates request bodies, headers, and route parameters. Valid requests are mapped to Cloudflare D1 prepared SQL statements.
3. **Database Layer**: Cloudflare D1 (SQLite) persists homes, members, bills, shares, and payment records. Referential integrity is strictly guarded by foreign keys with cascading deletes, `CHECK` constraints on positive integers, and `UNIQUE` constraints.

---

## Setup & Running Locally

### Prerequisites

- **Node.js** >= 20.x
- **pnpm** >= 9.x

### 1. Installation

Clone the repository and install all workspace dependencies:

```bash
git clone https://github.com/saitharun1604/shared-bill-splitter.git
cd shared-bill-splitter
pnpm install
```

### 2. Development Mode

Start both the API (`:8787`) and the Web app (`:5173`) concurrently. This automatically applies pending D1 migrations to the local database before starting:

```bash
pnpm dev
```

- **Web App:** [http://localhost:5173](http://localhost:5173)
- **API Health Check:** [http://127.0.0.1:8787/api/health](http://127.0.0.1:8787/api/health)

### 3. Verification & Quality Commands

```bash
pnpm check        # Biome: verify code formatting and lint rules (must pass)
pnpm check:fix    # Biome: automatically apply formatting/lint fixes
pnpm typecheck    # TypeScript: strict type check on both api and web packages
pnpm test         # Vitest: run all automated unit and integration tests
pnpm build        # Vite: create production build of the React web application
```

---

## API Endpoints

### Part 1: Homes and Members

- `POST /api/homes`: Create a home (`{ "name": string }` -> `201 { id, name }`).
- `POST /api/homes/:homeId/members`: Add a member to a home (`{ "name": string }` -> `201 { id, homeId, name }`).
- `GET /api/homes`: List all homes for quick selection in the UI.
- `GET /api/homes/:homeId/members`: List members belonging to a home.

### Part 2: Bill Splitting & Payments

- `POST /api/homes/:homeId/bills`: Add and split a bill (`{ "title": string, "totalCents": number }` -> `201 { id, homeId, title, totalCents, shares: [...] }`).
- `POST /api/bills/:billId/shares/:shareId/pay`: Pay a specific share. Requires `Idempotency-Key` header (`200 { id, memberId, amountCents, paidAt }`).
- `GET /api/homes/:homeId/balances`: Get current outstanding balances across all members in insertion order (`200 { balances: [{ memberId, name, outstandingCents }] }`).
- `GET /api/homes/:homeId/bills`: List bills and their member shares for a home.

---

## Idempotency and Concurrent Payments

Handling payments safely under retries and high concurrency is critical for financial applications:

### 1. Idempotency (`Idempotency-Key` Header)

- Every payment request to `POST /api/bills/:billId/shares/:shareId/pay` must supply an `Idempotency-Key` header (returns `400` if missing).
- The API queries the `payments` table for an existing record on `share_id`:
  - **Identical Key**: If the share was already paid using the _same_ `Idempotency-Key`, the API responds with `200 OK` and returns the previously generated payment data (`paidAt`). No second charge or duplicate record is created.
  - **Different Key**: If the share was already paid using a _different_ key, the API rejects the request with `409 Conflict` (`{ "error": "Share already paid with a different key" }`).

### 2. Concurrency & Race Condition Protection

When two requests attempt to pay the exact same unpaid share at the exact same millisecond:
- **Atomic Transaction**: The API executes both the `INSERT INTO payments` and the `UPDATE shares SET paid_at = ?` inside a single atomic D1 batch transaction (`c.env.DB.batch(...)`).
- **Database-Level Constraint**: The `payments` table contains a named constraint `CONSTRAINT uq_payments_share UNIQUE (share_id)`.
- **Race Outcome**: SQLite serializes writes. The first request succeeds and marks the share as paid. The second request immediately trips the `UNIQUE(share_id)` constraint and fails at the database level.
- **Graceful Recovery**: The catch block inspects the newly created payment record:
  - If the concurrent request carried the same idempotency key, it recovers and returns `200 OK`.
  - If it carried a different key, it returns `409 Conflict`.
- **UI Safety**: The frontend disables the payment button while a request is in flight (`"Processing..."`). If the payment fails (e.g., 409), the share remains in its unpaid state and displays a clear error alert without crashing.

---

## Technical Decisions

1. **Explicit `position` Column with `UNIQUE(home_id, position)` on `members`**:
   - _Decision_: Added an integer `position` column calculated via `(SELECT COALESCE(MAX(position), -1) + 1 FROM members WHERE home_id = ?)` along with a composite unique constraint `UNIQUE(home_id, position)`.
   - _Why_: Relational databases do not guarantee row order without an explicit `ORDER BY`. Relying on timestamps can lead to collisions when members are created concurrently or in rapid sequence. An explicit position ensures deterministic ordering for remainder cent distribution and balance reporting.

2. **Database-Level Uniqueness Constraint (`uq_payments_share`) Over Application Locks**:
   - _Decision_: Placed a hard `UNIQUE(share_id)` constraint on the `payments` table and coupled it with D1 atomic batch statements rather than relying solely on in-memory or application-level flags.
   - _Why_: In a distributed, serverless environment like Cloudflare Workers, in-memory mutexes do not span multiple worker instances. Enforcing uniqueness at the database layer guarantees absolute protection against double payments under all concurrency conditions.

3. **Whole-Integer Cent Arithmetic (`totalCents`, `amountCents`)**:
   - _Decision_: All monetary amounts are strictly accepted, stored, and calculated as integer whole cents. Fractions of cents are never stored.
   - _Why_: Floating-point numbers in JavaScript suffer from IEEE 754 precision issues (e.g. `0.1 + 0.2 === 0.30000000000000004`). By using integer division (`Math.floor(totalCents / n)`) and modulo (`totalCents % n`), the shares are guaranteed to always sum up exactly to the bill's `totalCents`.

---

## Verification Summary

All verification checks pass locally and in CI:
- **`pnpm check`**: Biome check passed with 0 errors.
- **`pnpm typecheck`**: Strict TypeScript compilation passed across all packages.
- **`pnpm test`**: 24 tests passed across 3 test suites (`homes.test.ts`, `bills.test.ts`, `payments.test.ts`).
- **`pnpm build`**: Web production bundle built successfully with Vite.
