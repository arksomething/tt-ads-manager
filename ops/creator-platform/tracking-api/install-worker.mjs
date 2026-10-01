import { createHash } from "node:crypto";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, symlinkSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
const credentialPath = process.argv[2];
if (process.getuid() !== 0 || !credentialPath?.startsWith("/")) throw new Error("Run as root with an absolute worker credential JSON path.");
const credential = JSON.parse(readFileSync(credentialPath,"utf8"));
if (!/^trk_worker_[a-f0-9]{64}$/.test(credential.token)) throw new Error("Invalid worker credential.");
const source = fileURLToPath(new URL("./",import.meta.url));
const files = ["worker.mjs","worker-launcher.sh"];
const digest = createHash("sha256");
for (const name of files) digest.update(name).update(readFileSync(`${source}${name}`));
const releaseId = digest.digest("hex");
const release = `/opt/tracking-api-worker/releases/${releaseId}`;
mkdirSync(release,{recursive:true,mode:0o755});
for (const name of files) {
  const destination = `${release}/${name}`;
  if (existsSync(destination)) {
    if (!readFileSync(destination).equals(readFileSync(`${source}${name}`))) throw new Error("Worker release integrity mismatch.");
  } else copyFileSync(`${source}${name}`,destination);
  chmodSync(destination,0o555);
}
chmodSync(release,0o555);
mkdirSync("/etc/tracking-api",{recursive:true,mode:0o700});
writeFileSync("/etc/tracking-api/worker.env",`TRACKING_API_BASE_URL=https://gotall-creator-platform.vercel.app\nTRACKING_API_WORKER_TOKEN=${credential.token}\n`,{mode:0o600});
chmodSync("/etc/tracking-api/worker.env",0o600);
const temporary = `/opt/tracking-api-worker/current-${process.pid}`;
symlinkSync(release,temporary);
renameSync(temporary,"/opt/tracking-api-worker/current");
for (const name of ["tracking-api-worker.service","tracking-api-worker.timer"]) {
  copyFileSync(`${source}${name}`,`/etc/systemd/system/${name}`);
  chmodSync(`/etc/systemd/system/${name}`,0o644);
}
execFileSync("systemctl",["daemon-reload"]);
console.log(JSON.stringify({installed_release:releaseId,timer_activation:"unchanged"}));
