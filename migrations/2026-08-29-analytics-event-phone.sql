-- The customer-facing analytics tracker (useAnalytics.ts) already reads a logged-in visitor's
-- phone from localStorage and sends it with every action POST — the backend just never had a
-- column to store it in, so it was silently dropped and the Activity Log's session badge only
-- ever showed the anonymous user-agent-hash fallback.
-- Safe to run: nullable, no backfill needed.
ALTER TABLE analytics_event
  ADD COLUMN IF NOT EXISTS phone VARCHAR(20);
