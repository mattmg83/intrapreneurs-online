# Intrapreneurs Online

Vite + React + TypeScript scaffold for an online playable adaptation of **Intrapreneurs**.

## Scripts

- `npm run dev` - start Vite local dev server for frontend-only iteration
- `npm run build` - type-check and production build
- `npm run preview` - preview production build
- `npm run lint` - run ESLint
- `npm run format` - format project with Prettier
- `npm run test` - run Vitest

## Vercel API routes (local)

To run frontend + serverless routes together locally, use Vercel dev:

```bash
vercel dev
```

Required environment variable:

- `GITHUB_TOKEN` (token with gist create/update permissions)

Implemented routes:

- `POST /api/rooms` creates a room gist containing `room.json`, then returns room id + seat invite links.
- `GET /api/rooms/:id` returns the room state and supports `ETag` / `If-None-Match` with `304`.
