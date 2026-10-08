// Windows offline source ZIP via built-in .NET; no npm dependency or model weight.
import { readdir, readFile, writeFile, mkdir, mkdtemp, lstat } from 'node:fs/promises';
import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID, createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { sanitizeEvidence } from './reports.js';

const sha = bytes=>createHash('sha256').update(bytes).digest('hex');
const execute=promisify(execFile);
const folders=['src','config','data','public','scripts','tests','templates','docs','eval'];
const excluded = name => name.split('/').some(p=>['var','.git','.agents','node_modules'].includes(p.toLowerCase()) || /^\.env(?:\..*)?$/i.test(p)&&p!=='.env.example')
  || /\.(?:gguf|safetensors|onnx|pt|pth|bin|zip)$/i.test(name);
async function dotnet(action, source, destination) {
  if(process.platform!=='win32')throw new Error('Packaging CLI currently requires Windows built-in PowerShell/.NET; runtime source remains Node.js portable.');
  const method=action==='zip'?'CreateFromDirectory':'ExtractToDirectory';
  await execute('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Add-Type -AssemblyName System.IO.Compression.FileSystem; [System.IO.Compression.ZipFile]::${method}($env:AGENT_BUNDLE_SOURCE,$env:AGENT_BUNDLE_DESTINATION)`],
    {env:{...process.env,AGENT_BUNDLE_SOURCE:source,AGENT_BUNDLE_DESTINATION:destination},windowsHide:true,timeout:60000});
}
export async function createSourceBundle({root,context,secrets=[]}) {
  const directory=join(resolve(root),'var','packages',`exam-source-${randomUUID()}`),stage=join(directory,'source');
  await mkdir(stage,{recursive:true});
  const files=[];
  async function copy(name){
    if(excluded(name))return;
    const path=join(root,name),info=await lstat(path);
    if(info.isSymbolicLink())throw new Error('Source bundle refuses linked files/directories.');
    if(info.isDirectory()){for(const entry of (await readdir(path)).sort())await copy(`${name}/${entry}`);return;}
    if(!info.isFile())throw new Error('Source bundle requires regular files.');
    const bytes=await readFile(path);
    if(secrets.filter(s=>s?.length>=8).some(s=>bytes.includes(Buffer.from(s))))throw new Error('Included source contains a configured credential; bundle refused.');
    await mkdir(dirname(join(stage,name)),{recursive:true});await writeFile(join(stage,name),bytes,{flag:'wx'});
    files.push({name,bytes:bytes.length,sha256:sha(bytes)});
  }
  try {
    for(const folder of folders){try{await lstat(join(root,folder));}catch(e){if(e.code==='ENOENT')continue;throw e;}await copy(folder);}
    for(const name of (await readdir(root)).sort()) if(name.endsWith('.md')||['package.json','package-lock.json','.env.example','.gitignore','LICENSE'].includes(name))await copy(name);
    const pkg=JSON.parse(await readFile(join(stage,'package.json'),'utf8'));
    if(Object.keys(pkg.dependencies??{}).length)throw new Error('Offline no-install bundle requires no runtime dependencies.');
    const manifest={version:1,created_at:new Date().toISOString(),commit:context.commit??'unknown',node_requirement:pkg.engines.node,
      context:sanitizeEvidence(context,{root,secrets}),self_checksum:'Manifest is excluded from its own file hashes; ZIP and manifest SHA256 are in the external artifact manifest.',
      files:files.sort((a,b)=>a.name.localeCompare(b.name))};
    const manifestBytes=JSON.stringify(manifest,null,2);await writeFile(join(stage,'PACKAGE_MANIFEST.json'),manifestBytes,{flag:'wx'});
    const zip=join(directory,'ai-agent-starter.zip');await dotnet('zip',stage,zip);
    const artifact={version:1,commit:manifest.commit,archive:'ai-agent-starter.zip',sha256:sha(await readFile(zip)),manifest_sha256:sha(manifestBytes),files:files.length};
    await writeFile(join(directory,'artifact-manifest.json'),JSON.stringify(artifact,null,2),{flag:'wx'});
    return {directory,stage,zip,manifest,artifact};
  } catch(error){await writeFile(join(directory,'FAILED.json'),JSON.stringify({status:'FAIL',reason:'Bundle creation failed; inspect source safety/filesystem support. No existing artifact was replaced.'}),{flag:'wx'});throw error;}
}
export async function extractBundle(bundle) {
  if(sha(await readFile(bundle.zip))!==bundle.artifact.sha256)throw new Error('Archive checksum mismatch.');
  const directory=await mkdtemp(join(tmpdir(),'agent-exam-restored-'));
  await dotnet('unzip',bundle.zip,directory);
  if(sha(await readFile(join(directory,'PACKAGE_MANIFEST.json')))!==bundle.artifact.manifest_sha256)throw new Error('Manifest checksum mismatch.');
  return directory;
}
export async function verifyBundle(root) {
  const manifest=JSON.parse(await readFile(join(root,'PACKAGE_MANIFEST.json'),'utf8')),failures=[];
  for(const file of manifest.files){
    const target=resolve(root,file.name),rel=relative(resolve(root),target);
    if(isAbsolute(rel)||rel.startsWith('..')||excluded(file.name)){failures.push('Invalid manifest entry.');continue;}
    try { const info=await lstat(target),bytes=await readFile(target);if(info.isSymbolicLink()||bytes.length!==file.bytes||sha(bytes)!==file.sha256)failures.push(file.name); }
    catch{failures.push(file.name);}
  }
  return {status:failures.length?'FAIL':'PASS',files:manifest.files.length,failures,node_requirement:manifest.node_requirement,commit:manifest.commit};
}
