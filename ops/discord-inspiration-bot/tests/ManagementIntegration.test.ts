import { ownsInspirationInteraction } from '../src/management';

test('management routing is limited to the configured application, guild and feature', () => {
  const raw = { application_id: 'management', guild_id: 'production', type: 2, data: { name: 'predict' } };
  expect(ownsInspirationInteraction(raw, 'production', 'management')).toBe(true);
  expect(ownsInspirationInteraction({ ...raw, guild_id: 'test' }, 'production', 'management')).toBe(false);
  expect(ownsInspirationInteraction({ ...raw, application_id: 'old-bot' }, 'production', 'management')).toBe(false);
  expect(ownsInspirationInteraction({ ...raw, data: { name: 'creator' } }, 'production', 'management')).toBe(false);
  expect(ownsInspirationInteraction({ ...raw, type: 3, data: { custom_id: 'gt:apply' } }, 'production', 'management')).toBe(false);
  expect(ownsInspirationInteraction({ ...raw, type: 3, data: { custom_id: 'inspiration:subscribe' } }, 'production', 'management')).toBe(true);
});
