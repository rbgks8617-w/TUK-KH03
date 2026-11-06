import { DiscordSDK } from '@discord/embedded-app-sdk';

let discord;

const rpcFrame = 1;

function isSmallRpcFrame(frame) {
  let remainingValues = 512;
  let remainingText = 64 * 1024;

  function visit(value, depth) {
    if (--remainingValues < 0 || depth > 12) return false;
    if (typeof value === 'string') {
      remainingText -= value.length;
      return remainingText >= 0;
    }
    if (value === null || typeof value !== 'object') return true;
    if (Array.isArray(value) && value.length > 64) return false;
    for (const key in value) {
      remainingText -= key.length;
      if (remainingText < 0 || !visit(value[key], depth + 1)) return false;
    }
    return true;
  }

  return visit(frame, 0);
}

function limitDiscordMessage(event) {
  const message = event.data;
  if (Array.isArray(message) && message[0] === rpcFrame && !isSmallRpcFrame(message)) {
    event.stopImmediatePropagation();
  }
}

export async function connectDiscord(clientId, join) {
  if (!discord) {
    // Capture oversized RPC frames before the SDK can allocate validation errors.
    window.addEventListener('message', limitDiscordMessage, { capture: true });
    discord = new DiscordSDK(clientId, { disableConsoleLogOverride: true });
  }
  await withTimeout(discord.ready(), 10_000, 'Discord 연결 시간이 초과됐어요.');
  const { code } = await withTimeout(discord.commands.authorize({
    client_id: clientId,
    response_type: 'code',
    prompt: 'none',
    scope: ['identify']
  }), 30_000, 'Discord 인증 시간이 초과됐어요. 다시 연결해 주세요.');
  return join({ authorizationCode: code, instanceId: discord.instanceId });
}

async function withTimeout(request, duration, message) {
  let timeout;
  try {
    return await Promise.race([
      request,
      new Promise((_, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), duration);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}
