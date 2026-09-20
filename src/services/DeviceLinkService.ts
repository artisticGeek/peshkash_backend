import { sequelize } from '../config/sequelize';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidDeviceId(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * DeviceLinkService — the only place device_link is ever written.
 *
 * `touch()` is called on every anonymous analytics event to keep the device row fresh.
 * `link()` is called ONLY from a successful OTP verification (AuthController.verifyOtp) —
 * never from a client-supplied device+phone pairing. That's what makes the link trustworthy:
 * by the time it's called, the server has already independently confirmed the phone is real.
 *
 * Both are best-effort: never throw, never block the caller.
 */
export const DeviceLinkService = {
  touch(deviceId: unknown): void {
    if (!isValidDeviceId(deviceId)) return;
    sequelize.query(
      `INSERT INTO device_link (device_id, first_seen_at, last_seen_at)
       VALUES (:deviceId, NOW(), NOW())
       ON CONFLICT (device_id) DO UPDATE SET last_seen_at = NOW()`,
      { replacements: { deviceId } }
    ).catch(() => {});
  },

  async link(deviceId: unknown, phone: string): Promise<void> {
    if (!isValidDeviceId(deviceId)) return;
    await sequelize.query(
      `INSERT INTO device_link (device_id, phone, first_seen_at, linked_at, last_seen_at)
       VALUES (:deviceId, :phone, NOW(), NOW(), NOW())
       ON CONFLICT (device_id) DO UPDATE SET phone = :phone, linked_at = NOW(), last_seen_at = NOW()`,
      { replacements: { deviceId, phone } }
    ).catch(() => {});
  },
};
