# Intrapreneurs Online

Vite + React + TypeScript scaffold for an online playable adaptation of **Intrapreneurs**.

## Local development

### 1) Install dependencies

```bash
npm install
```

### 2) Configure environment variables

Create `.env.local` (for Vite + Vercel local dev) with:

```bash
GITHUB_TOKEN=ghp_your_token_here
```

`GITHUB_TOKEN` is required for all room operations because the backend persists room state in GitHub Gists.

### 3) Run the app

You can run frontend-only development with:

```bash
npm run dev
```

For full-stack local development (frontend + Vercel serverless API routes), run:

```bash
vercel dev
```

Open the URL printed by Vercel (typically `http://localhost:3000`).

## Deploying to Vercel

1. Import this repository into Vercel.
2. In **Project Settings → Environment Variables**, add:
   - `GITHUB_TOKEN` (must have gist create/update/read permissions).
3. Deploy.
4. Verify:
   - `POST /api/rooms` can create a room.
   - `GET /api/rooms/:id` returns room state.
   - joining and actions work end-to-end from the `/play` flow.

## How gist storage works

- Each room is stored as a private GitHub Gist containing a `room.json` file.
- `POST /api/rooms` creates the gist and initializes state (rounds, seats, decks, etc.).
- `GET /api/rooms/:id` reads gist state and returns a public-safe projection.
- `POST /api/rooms/:id/act` applies a validated action and PATCHes `room.json`.
- Writes are optimistic and guarded by GitHub ETag / `If-Match` to prevent lost updates.

## Privacy model

- **Public/shared state** (turn, market, scores, seat metadata) is stored in the room gist.
- **Seat secrets** (seat token / tokenHash) are stripped from API responses before returning room state.
- **Private hand cards are client-local**: card identities are tracked in browser `localStorage` and updated through `privateDelta` responses.
- This means gameplay is optimized for low-friction play, not cryptographic secrecy.


### SPA deep-link routing on Vercel

A root `vercel.json` routes `/api/*` to serverless functions, then falls back all other non-file paths (for example `/play` and `/rules`) to `index.html`. This prevents Vercel `404: NOT_FOUND` responses on direct URL visits and lets React Router handle client-side routes.

## Troubleshooting

### 401 / 403 from API routes

- Confirm `GITHUB_TOKEN` is present in local or Vercel env vars.
- Ensure the token is valid and has permission to read/write gists.
- After changing env vars locally, restart `vercel dev`.

### GitHub API rate limits

- Authenticated requests get higher limits; always use `GITHUB_TOKEN`.
- If you hit secondary limits, wait briefly and retry.
- Reduce noisy polling by keeping inactive tabs hidden (polling pauses when hidden).

### 409 conflicts while acting

- A 409 usually means room state changed before your action completed (version, ETag, or turn nonce mismatch).
- Refresh state (the client auto-fetches latest state) and retry the action.
- If repeated, verify only one active tab/session is submitting actions for the same seat.

## Scripts

- `npm run dev` - start local dev server
- `npm run build` - type-check and production build
- `npm run preview` - preview production build
- `npm run lint` - run ESLint
- `npm run format` - format project with Prettier
- `npm run test` - run Vitest
