import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {assertRuntime} from './runtime-scope.mjs';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';

export const accessTutorials = [
  { key: 'ios', filename: 'ios-unlock.mp4', title: 'Get GoTall free on iPhone', description: '**1. Install the test app**\nOpen [the GoTall TestFlight invite](https://testflight.apple.com/join/JKJ1pmE9) on your iPhone. Install TestFlight if asked, then accept the invite and install GoTall.\n\n**2. Open GoTall**\nAnswer the setup questions and continue to the subscription screen. Tap a plan to open the TestFlight confirmation.\n\n**3. Check, then confirm**\nThe sheet must say **"For testing purposes only. You will not be charged for confirming this purchase."** Then confirm with the side button as shown below.\n\n**Do not see that message? Stop before confirming.** Tag <@571179674323910667> in your creator channel with a screenshot. Hide account or payment details.' },
  { key: 'android', filename: 'android-install.mp4', title: 'Get GoTall free on Android - install', description: '**1. Join the test**\nOpen [the GoTall testing link](https://play.google.com/apps/testing/app.gotall.play) using the Google account you use in the Play Store. Tap **Become a tester**.\n\n**2. Install GoTall**\nFollow the Google Play link on that page and download the app. The video below shows the steps.\n\n**3. Open the app**\nAnswer the setup questions, then follow the next video to unlock access.\n\n**Cannot join or find the app?** Tag <@571179674323910667> in your creator channel. Do not pay for the regular version to get around an access problem.' },
  { key: 'android_unlock', filename: 'android-unlock.mp4', title: 'Android - unlock free access', description: '**1. Open the subscription screen**\nAfter setup, select a plan to open the Google Play payment sheet.\n\n**2. Check the test message**\nIt must say **"This is a test subscription"** and **"You will not be charged."** The recording shows **Test card, always approves**.\n\n**3. Confirm**\nOnly after seeing that test message, tap **Subscribe** or **Pay**. The app should unlock.\n\n**No test message? Stop before confirming.** Tag <@571179674323910667> in your creator channel with a screenshot. Hide account or payment details.\n\nThe recording uses an older app design; the test-purchase message is the important check.' },
];

export function accessDirectory(r) {
  const base=`https://discord.com/channels/1245112089647775877/${r.channel_app_access}`;
  return {content:'',embeds:[{title:'Find your app guide',description:`**On iOS?** [Click here](${base}/${r.message_access_ios}).\n\n**On Android?** [Click here](${base}/${r.message_access_android}).`,color:0x8b9c87}],allowed_mentions:{parse:[]},components:[]};
}

export async function syncAccessTutorials({config,database,bot,api,resources,save}) {
  assertRuntime(config);
  const r=resources(database), channelId=r.channel_app_access;
  for(const tutorial of accessTutorials) {
    const bytes=readFileSync(join(dirname(fileURLToPath(import.meta.url)),'assets','app-access',tutorial.filename));
    const hash=createHash('sha256').update(bytes).digest('hex');
    const key=`message_access_${tutorial.key}`;
    let existing, id=r[key];
    if(id)try{existing=await api(config,`/channels/${channelId}/messages/${id}`);}catch(e){if(e.status!==404)throw e;}
    if(!existing) {
      const recent=await api(config,`/channels/${channelId}/messages?limit=100`);
      existing=recent.find(m=>m.author?.id===bot.id&&m.embeds?.[0]?.title===tutorial.title);
      id=existing?.id;
    }
    const body={content:'',embeds:[{title:tutorial.title,description:tutorial.description,color:0x8b9c87,author:{name:'GoTall Creators'}}],allowed_mentions:{parse:[]},components:[]};
    const attachment=existing?.attachments?.find(a=>a.filename===tutorial.filename&&a.size===bytes.length);
    const method=existing?'PATCH':'POST', path=`/channels/${channelId}/messages${existing?`/${id}`:''}`;
    let sent;
    if(attachment&&r[`hash_access_${tutorial.key}`]===hash) {
      sent=await api(config,path,{method,body:JSON.stringify({...body,attachments:[{id:attachment.id,filename:attachment.filename}]})});
    } else {
      const form=new FormData();
      form.set('payload_json',JSON.stringify({...body,attachments:[{id:0,filename:tutorial.filename}]}));
      form.set('files[0]',new Blob([bytes],{type:'video/mp4'}),tutorial.filename);
      sent=await api(config,path,{method,body:form});
    }
    id=sent.id||id;
    save(database,key,id);save(database,`hash_access_${tutorial.key}`,hash);
    if(!existing?.pinned)await api(config,`/channels/${channelId}/pins/${id}`,{method:'PUT'});
  }
  const current=resources(database), body=accessDirectory(current);
  body.embeds[0].description=body.embeds[0].description.replaceAll('1245112089647775877',config.guildId);
  let existing;
  if(current.message_access_directory) {
    try{existing=await api(config,`/channels/${channelId}/messages/${current.message_access_directory}`);}
    catch(e){if(e.status!==404)throw e;}
  }
  if(!existing) {
    const recent=await api(config,`/channels/${channelId}/messages?limit=100`);
    existing=recent.find(m=>m.author?.id===bot.id&&m.embeds?.[0]?.title===body.embeds[0].title);
  }
  const sent=await api(config,`/channels/${channelId}/messages${existing?`/${existing.id}`:''}`,{method:existing?'PATCH':'POST',body:JSON.stringify(body)});
  const id=sent.id||existing.id;
  save(database,'message_access_directory',id);
  if(!existing?.pinned)await api(config,`/channels/${channelId}/pins/${id}`,{method:'PUT'});
}
