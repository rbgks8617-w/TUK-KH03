'use strict';

const { DISCORD_CLIENT_ID, DISCORD_CLIENT_SECRET, DISCORD_BOT_TOKEN } = process.env;
const clientId = DISCORD_CLIENT_ID && DISCORD_CLIENT_SECRET && DISCORD_BOT_TOKEN ? DISCORD_CLIENT_ID : null;
const api = 'https://discord.com/api/v10';

async function discordRequest(path, options) {
  const response = await fetch(api + path, { ...options, signal: AbortSignal.timeout(8000) });
  if (!response.ok) throw new Error('Discord API returned ' + response.status);
  return response.json();
}

async function verifyParticipant(instanceId, authorizationCode) {
  const credentials = await discordRequest('/oauth2/token', {
    method: 'POST',
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code: authorizationCode
    })
  });
  const [user, instance] = await Promise.all([
    discordRequest('/users/@me', { headers: { Authorization: 'Bearer ' + credentials.access_token } }),
    discordRequest('/applications/' + clientId + '/activity-instances/' + encodeURIComponent(instanceId), {
      headers: { Authorization: 'Bot ' + DISCORD_BOT_TOKEN }
    })
  ]);
  if (!instance.users.includes(user.id)) return null;
  const avatar = user.avatar
    ? 'avatars/' + user.id + '/' + user.avatar + '.png?size=128'
    : 'embed/avatars/' + ((BigInt(user.id) >> 22n) % 6n) + '.png';
  return { discordId: user.id, name: user.global_name || user.username, avatar: './discord-cdn/' + avatar };
}

module.exports = { clientId, verifyParticipant };
