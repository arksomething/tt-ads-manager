import {spawn} from 'node:child_process';
import {randomUUID} from 'node:crypto';

export async function loadOwnedEarningsSource(prisma, {creatorId, organizationId, startDate, endDate}) {
 const accounts=await prisma.creatorPlatformAccount.findMany({where:{creatorId,creator:{organizationId},platform:'TIKTOK'},select:{sourceAccountId:true,platform:true}});
 if(!accounts.length||accounts.some(a=>!a.sourceAccountId))throw Error('Verified native account IDs are required for owned earnings.');
 const request={start_date:startDate,end_date:endDate,accounts:accounts.map(a=>({platform:a.platform.toLowerCase(),native_account_id:a.sourceAccountId}))};
 return await new Promise((resolve,reject)=>{
  // The existing user service manager runs the fixed, root-owned reader outside
  // the gateway's NoNewPrivileges sandbox, as with the verified binding reader.
  const runtimeDir=`/run/user/${process.getuid()}`;
  const proc=spawn('systemd-run',['--user','--wait','--pipe','--quiet','--collect','--unit=gotall-owned-earnings-'+randomUUID(),'--property=RuntimeMaxSec=45','sudo','-n','/usr/bin/python3','/usr/local/lib/gotall-discord-onboarding-test/owned-earnings-source.py'],{stdio:['pipe','pipe','pipe'],env:{...process.env,XDG_RUNTIME_DIR:runtimeDir,DBUS_SESSION_BUS_ADDRESS:`unix:path=${runtimeDir}/bus`}});
  let output='';let size=0;
  const timer=setTimeout(()=>{proc.kill();reject(Error('Owned earnings source timed out.'));},50000);
  proc.stdout.on('data',b=>{size+=b.length;if(size>30_000_000){proc.kill();return;}output+=b;});
  proc.stderr.resume();proc.on('error',e=>{clearTimeout(timer);reject(e);});
  proc.on('close',code=>{clearTimeout(timer);if(code!==0||size>30_000_000)return reject(Error('Owned tracker evidence unavailable; no provider fallback used.'));try{resolve(JSON.parse(output));}catch{reject(Error('Invalid owned tracker evidence.'));}});
  proc.stdin.end(JSON.stringify(request));
 });
}
