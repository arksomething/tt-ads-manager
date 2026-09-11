import { canonicalVideo, httpsUrl, text } from './flow.mjs';

const ttHosts = new Set(['tiktok.com','www.tiktok.com','m.tiktok.com','vm.tiktok.com','vt.tiktok.com']);
const safeTikTok = value => {
  const url = httpsUrl(value);
  if (!url) return null;
  const parsed = new URL(url);
  return ttHosts.has(parsed.hostname) && !parsed.port ? parsed : null;
};
export async function resolveVideo(value, request = fetch) {
  // Accept the complete text copied from TikTok's Share > Copy link action.
  const links = text(value, 2000).match(/https:\/\/[^\s<>]+/gu) || [];
  if (links.length !== 1) throw new Error('Paste one published video link or TikTok share link.');
  let url = links[0];
  try { return canonicalVideo(url); } catch {}
  const signal = AbortSignal.timeout(8000);
  try {
    for (let hop = 0; hop < 6; hop++) {
      const parsed = safeTikTok(url);
      if (!parsed) break;
      const response = await request(parsed.href, {redirect:'manual', signal});
      await response.body?.cancel();
      if (![301,302,303,307,308].includes(response.status)) break;
      const location = response.headers.get('location');
      if (!location) break;
      url = new URL(location, parsed).href;
      if (!safeTikTok(url)) break;
      try { return canonicalVideo(url); } catch {}
    }
  } catch {}
  throw new Error('Could not open that TikTok share link. Open the video in your browser and copy its full video URL, then try again.');
}

export async function resolvePublishedField(value, platform, {testMode=false,request=fetch}={}) {
  const raw=String(value||'').trim();
  const candidates=raw.match(/(?:https?:\/\/)?(?:[a-z0-9-]+\.)+(?:com|be|net)(?:\/[^\s<>]*)?/giu)||[];
  if(candidates.length!==1)throw new Error(`Paste one ${platform==='instagram'?'Instagram reel or post':'TikTok video or share'} link in this field.`);
  let link=candidates[0].replace(/[)\],.!?;]+$/u,'');
  if(!/^https?:\/\//iu.test(link))link='https://'+link;
  const url=new URL(link);
  if(testMode && ['example.com','www.example.com'].includes(url.hostname))
    return {key:`${platform}:example:${url.pathname}`,url:url.href};
  if(platform==='instagram') {
    if(!['instagram.com','www.instagram.com','m.instagram.com'].includes(url.hostname))throw new Error('The Instagram field needs an instagram.com reel or post link.');
    const match=url.pathname.match(/^\/(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)\/?$/u);
    if(!match)throw new Error('Use the Instagram reel or post link, not the account profile. Open the post and choose Share → Copy link.');
    return {key:`instagram:${match[1]}`,url:`https://www.instagram.com/reel/${match[1]}/`};
  }
  const video=await resolveVideo(link,request);
  if(!video.key.startsWith('tiktok:'))throw new Error('The TikTok field needs a TikTok video or share link.');
  return video;
}

export function draftAttachment(interaction) {
  const fields = (interaction.data?.components || []).flatMap(r => r.component ? [r.component] : r.components || []);
  const ids = fields.find(c => c.custom_id === 'video_file')?.values || [];
  if (!ids.length) return null;
  if (ids.length !== 1) throw new Error('Upload one video draft at a time.');
  const file = interaction.data?.resolved?.attachments?.[ids[0]];
  if (!file || !/^video\//u.test(file.content_type || '') || !/\.(mp4|mov|webm|m4v)$/iu.test(file.filename || ''))
    throw new Error('Upload an MP4, MOV, WebM or M4V video, or use a draft link.');
  if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > 25 * 1024 * 1024)
    throw new Error('Video uploads must be 25 MB or smaller. Use a draft link for larger files.');
  const url = httpsUrl(file.url);
  if (!url || new URL(url).hostname !== 'cdn.discordapp.com' || new URL(url).port || !/^\/(?:ephemeral-)?attachments\//u.test(new URL(url).pathname))
    throw new Error('Discord supplied an unsupported attachment address. Please upload the video again or submit a draft link. This is an upload error, not a content review.');
  return file;
}

export async function saveDraftUpload(config, interaction, file, api, request = fetch) {
  // Store a channel-message link, not an expiring signed CDN URL.
  const nonce = `draft${interaction.id}`;
  const path = `/channels/${interaction.channel_id}/messages`;
  const recent = await api(config, `${path}?limit=100`);
  let message = recent.find(m => m.author?.id === config.applicationId && m.nonce === nonce);
  if (!message) {
    const response = await request(file.url, {redirect:'error', signal:AbortSignal.timeout(30000)});
    if (!response.ok) throw new Error('The video upload could not be downloaded. Please try again.');
    const chunks = []; let size = 0;
    for await (const chunk of response.body) {
      size += chunk.length;
      if (size > 25 * 1024 * 1024) throw new Error('Video uploads must be 25 MB or smaller. Use a draft link.');
      chunks.push(chunk);
    }
    if (size !== file.size) throw new Error('The upload was incomplete. Please upload the video again.');
    const form = new FormData();
    form.append('payload_json', JSON.stringify({content:'Creator uploaded a video draft for staff review.', nonce, enforce_nonce:true, allowed_mentions:{parse:[]}, attachments:[{id:0,filename:'creator-draft.'+file.filename.split('.').pop().toLowerCase()}]}));
    form.append('files[0]', new Blob(chunks,{type:file.content_type}), 'creator-draft.'+file.filename.split('.').pop().toLowerCase());
    message = await api(config, path, {method:'POST',body:form});
  }
  return `https://discord.com/channels/${config.guildId}/${interaction.channel_id}/${message.id}`;
}

export function publicCreatorResponse(interaction, creator, startChannelId, staffReviewChannelId, authorizedStaff=false) {
  if(interaction.data?.custom_id?.endsWith(':payment_profile'))return false;
  if(authorizedStaff && staffReviewChannelId && interaction.channel_id===staffReviewChannelId && /^gt:(?:form:)?review:\d+:/u.test(interaction.data?.custom_id||''))return true;
  if(startChannelId && interaction.channel_id===startChannelId)return false;
  const action = interaction.data?.custom_id?.replace(/^gt:(?:form:)?/u, '');
  const user = interaction.member?.user?.id ?? interaction.user?.id;
  if (interaction.type === 5 && interaction.data?.custom_id === 'gotall-apply-v1') return true;
  if (interaction.type === 2) return interaction.data?.name === 'status' && creator?.discord_user_id === user && !(interaction.data?.options || []).some(o => o.name === 'creator' && o.value !== user);
  if (['guide','resume','help'].includes(action)) return false;
  return creator?.discord_user_id === user && ['accounts','ready','post','leave','complete_warmup','signed','first_video','test_signed'].includes(action);
}
