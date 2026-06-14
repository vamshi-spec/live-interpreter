import { AccessToken } from 'livekit-server-sdk';
import { config } from '../config.js';

/**
 * Mint a short-lived LiveKit access token.
 * Listeners get subscribe-only (canPublish: false) — they can never broadcast.
 * The server-side publisher gets its own token with publish rights (see publisher.js).
 */
export async function createListenerToken({ room, identity, name }) {
  const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
    identity,
    name,
    ttl: '2h',
  });
  at.addGrant({
    room,
    roomJoin: true,
    canPublish: false,
    canPublishData: false,
    canSubscribe: true,
  });
  return await at.toJwt();
}

export async function createPublisherToken({ room, identity = 'interpreter-bot' }) {
  const at = new AccessToken(config.livekit.apiKey, config.livekit.apiSecret, {
    identity,
    ttl: '6h',
  });
  at.addGrant({
    room,
    roomJoin: true,
    canPublish: true,
    canPublishData: true, // used to push live captions over the data channel
    canSubscribe: false,
  });
  return await at.toJwt();
}
