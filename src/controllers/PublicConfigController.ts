/**
 * PublicConfigController — the small subset of app_config safe to hand to
 * any visitor, unauthenticated. Never add a key here without checking it
 * isn't sensitive: this response has no auth gate.
 */
import { Request, Response } from 'express';
import { makeAppConfigReader } from '../utils/AppConfigUtil';

const readDisableInspect = makeAppConfigReader('disable_inspect', 'false');

export const PublicConfigController = {
  async get(_req: Request, res: Response): Promise<void> {
    const disableInspect = (await readDisableInspect()) === 'true';
    res.json({ disableInspect });
  },
};
