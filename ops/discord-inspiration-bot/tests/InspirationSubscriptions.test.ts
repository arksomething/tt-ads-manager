import { InspirationSubscriptions, notificationPayload, SUBSCRIBE, UNSUBSCRIBE } from '../src/bot/InspirationSubscriptions';

const role='123456789012345678';
test('milestones explicitly allow only the opt-in role, never everyone or user mentions',()=>{
  const p=notificationPayload(role,'https://example.com/@everyone');
  expect(p.allowedMentions).toEqual({parse:[],roles:[role],users:[],repliedUser:false});
  expect(p.content.startsWith(`<@&${role}>`)).toBe(true);
  expect(()=>notificationPayload('@everyone')).toThrow();
  expect(()=>notificationPayload('')).toThrow();
});

test.each([[SUBSCRIBE,'add'],[UNSUBSCRIBE,'remove']])('self-service %s changes only the clicking member and configured role',async(id,method)=>{
  const member={roles:{add:jest.fn(),remove:jest.fn()}};
  const fetchMember=jest.fn().mockResolvedValue(member);
  const client={guilds:{fetch:jest.fn().mockResolvedValue({members:{fetch:fetchMember}})}};
  const s=new InspirationSubscriptions(client as any,'guild','channel',role);
  s.preflight=jest.fn().mockResolvedValue(undefined);
  const i={customId:id,guildId:'guild',channelId:'channel',user:{id:'clicker'},deferReply:jest.fn(),editReply:jest.fn()};
  expect(await s.handle(i as any)).toBe(true);
  expect(fetchMember).toHaveBeenCalledWith('clicker');
  expect(member.roles[method as 'add'|'remove']).toHaveBeenCalledWith(role,expect.any(String));
  expect(i.deferReply).toHaveBeenCalledWith({ephemeral:true});
});

test('buttons in another channel cannot modify roles',async()=>{
  const client={guilds:{fetch:jest.fn()}};
  const s=new InspirationSubscriptions(client as any,'guild','channel',role);
  const i={customId:SUBSCRIBE,guildId:'guild',channelId:'elsewhere',reply:jest.fn()};
  await s.handle(i as any);
  expect(client.guilds.fetch).not.toHaveBeenCalled();
});

test('mentionable opt-in role works while everyone mentions stay denied', async () => {
  const { TextChannel } = require('discord.js');
  const channel = Object.create(TextChannel.prototype);
  Object.defineProperty(channel, 'guildId', { value: 'guild' });
  channel.permissionsFor = () => ({ has: (p: string | string[]) => p !== 'MentionEveryone' });
  const alertRole = { managed: false, id: role, permissions: { bitfield: 0n }, editable: true, mentionable: true };
  const guild = { id: 'guild', roles: { fetch: async () => alertRole }, members: { fetchMe: async () => ({ permissions: { has: () => true } }) } };
  const client = { guilds: { fetch: async () => guild }, channels: { fetch: async () => channel } };
  const subscriptions = new InspirationSubscriptions(client as any, 'guild', 'channel', role);
  await expect(subscriptions.preflight()).resolves.toBeUndefined();
  alertRole.mentionable = false;
  await expect(subscriptions.preflight()).rejects.toThrow('must be mentionable');
});
