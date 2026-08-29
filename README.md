# Peshkash backend

Express, TypeScript, Sequelize, and PostgreSQL API for Peshkash.

## Full local development

Copy `.env.example` to `.env`, provide a PostgreSQL `DATABASE_URL`, then run:

```bash
npm install
npm run dev
```

The API listens on port 4000 by default and runs idempotent migrations before accepting traffic.

## Database-free QR Studio mode

This starts the HTTP layer for frontend and visual development while PostgreSQL migrations and workers remain paused:

```bash
npm run build
npm run start:studio
```

The frontend then falls back to browser-local QR Studio drafts. Database-backed admin routes still require the normal authenticated database environment.

## QR Studio persistence

Migration `migrations/2026-08-27-qr-studio-library.sql` extends `qr_templates` with:

- `library_template_id`
- `manifest_version`
- `qr_style`
- `theme`
- `settings`

The API validates the 30 approved library IDs, both approved QR signatures, and light/dark surface values. Legacy `elements` data remains supported.

Migration `migrations/2026-08-29-design-studio-document.sql` adds the unified Studio contract:

- versioned `document` JSON and `schema_version`
- optimistic-lock `revision`
- optional `preview_thumbnail`
- vendor ownership and its lookup index

The canonical persistence routes are under `/api/admin/designs`; `/api/admin/qr-templates` remains available during migration. Vendors can read global and owned designs but only mutate their own. Updates with a stale revision return HTTP 409. Duplicate and validation endpoints are available at `/api/admin/designs/:id/duplicate` and `/api/admin/designs/:id/validate`.

Approved destination hosts default to `peshkash.app`, `www.peshkash.app`, `pksh.in`, and `pksh.example`. Override that deployment allowlist with the comma-separated `PESHKASH_QR_HOSTS` environment variable.

## Check

```bash
npm run build
```
