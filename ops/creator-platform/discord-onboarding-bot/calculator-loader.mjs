import {registerHooks,stripTypeScriptTypes} from 'node:module';
import {existsSync,readFileSync} from 'node:fs';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root='/home/ark296/projects/tt-ads-manager/web';
registerHooks({
 resolve(specifier,context,next){
  // This read-only worker has no Next request cache. Preserve the underlying
  // calculator calls without requiring a running Next server.
  if(specifier==='next/cache')return {url:'gotall:uncached-read',shortCircuit:true};
  let candidate=specifier.startsWith('@/')?pathToFileURL(`${root}/src/${specifier.slice(2)}`).href:specifier.startsWith('.')&&context.parentURL?new URL(specifier,context.parentURL).href:null;
  if(candidate?.startsWith('file:')){
   const path=fileURLToPath(candidate);
   for(const suffix of ['', '.ts','.tsx','/index.ts'])if(existsSync(path+suffix)&&/\.[cm]?[jt]sx?$/u.test(path+suffix))return {url:pathToFileURL(path+suffix).href,shortCircuit:true};
  }
  try{return next(specifier,context);}catch(e){if(specifier.startsWith('next/')&&!specifier.endsWith('.js'))return next(specifier+'.js',context);throw e;}
 },
 load(url,context,next){
  if(url==='gotall:uncached-read')return {format:'module',source:'export const unstable_cache = fn => fn; export const revalidatePath = () => { throw new Error("Read-only calculator worker"); }; export const revalidateTag = revalidatePath;',shortCircuit:true};
  if(url.startsWith('file:')&&url.endsWith('.ts')&&!url.includes('/node_modules/'))return {format:'module',source:stripTypeScriptTypes(readFileSync(fileURLToPath(url),'utf8'),{mode:'transform',sourceUrl:url}),shortCircuit:true};
  return next(url,context);
 }
});
