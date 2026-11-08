// Authentication middleware using timing-safe token comparison
// Data plane component

import * as crypto from 'crypto';
import type { Caller, GatewayConfig } from '../types.js';

export function authenticate(
  authHeader: string | undefined,
  gatewayConfig: GatewayConfig
): Caller | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return null;
  }

  const token = authHeader.slice(7);
  const tokenHash = crypto.createHash('sha256').update(token).digest();

  for (const caller of gatewayConfig.callers) {
    const callerToken = caller.token ?? (caller.token_env ? process.env[caller.token_env] : undefined);
    if (!callerToken) {
      continue;
    }

    const callerTokenHash = crypto.createHash('sha256').update(callerToken).digest();

    if (tokenHash.length === callerTokenHash.length) {
      if (crypto.timingSafeEqual(tokenHash, callerTokenHash)) {
        return {
          id: caller.id,
          type: caller.type,
          scopes: [...caller.scopes],
        };
      }
    }
  }

  return null;
}
