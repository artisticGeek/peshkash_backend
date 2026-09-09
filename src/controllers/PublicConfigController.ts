/**
 * PublicConfigController — the small subset of app_config safe to hand to
 * any visitor, unauthenticated. Never add a key here without checking it
 * isn't sensitive: this response has no auth gate.
 */
import { Request, Response } from 'express';
import { makeAppConfigReader } from '../utils/AppConfigUtil';

const readDisableInspect     = makeAppConfigReader('disable_inspect', 'false');
// How long the "please log in" nudge waits before reopening after a visitor dismisses it on a
// vendor with requireLogin=true. Deliberately not a hard block — it's a nag, not an auth gate —
// so it must stay dismissible; this only controls how persistent the nag is.
// To change it: UPDATE app_config SET value = '10000' WHERE key = 'require_login_renag_ms';
const readRequireLoginRenagMs = makeAppConfigReader('require_login_renag_ms', '5000');

export const PublicConfigController = {
  async get(_req: Request, res: Response): Promise<void> {
    const [disableInspect, requireLoginRenagMs] = await Promise.all([
      readDisableInspect(),
      readRequireLoginRenagMs(),
    ]);
    res.json({
      disableInspect: disableInspect === 'true',
      requireLoginRenagMs: Number(requireLoginRenagMs) || 5000,
    });
  },
};
