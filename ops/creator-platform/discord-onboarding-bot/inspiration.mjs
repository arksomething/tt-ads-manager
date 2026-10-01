import { createRequire } from 'node:module';
export async function startInspiration(config, readCredential) {
  if (process.env.GOTALL_INSPIRATION_ENABLED !== 'true') return null;
  const require = createRequire(import.meta.url);
  const { createManagementInspiration } = require('./inspiration/dist/management.js');
  return createManagementInspiration({
    discord: { token: config.token, clientId: config.applicationId },
    openai: { apiKey: readCredential('inspiration-openai-key') },
    viral: { apiKey: readCredential('inspiration-viral-key'), apiUrl: 'https://viral.app/api/v1' },
    environment: 'production',
    milestones: {
      enabled: process.env.GOTALL_INSPIRATION_FEED_ENABLED === 'true',
      guildId: '1400610531189985310', channelId: '1481528900025847838',
      notificationRoleId: '1548936204186030111',
      pollIntervalMs: 600000, viewThreshold: 100000,
      stateFilePath: '/var/lib/gotall-discord-onboarding-test/inspiration/video-milestones.json',
    },
  });
}
