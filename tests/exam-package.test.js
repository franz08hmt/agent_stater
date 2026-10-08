import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSourceBundle, verifyBundle, extractBundle } from '../src/operations/package.js';
async function root(t){const r=await mkdtemp(join(tmpdir(),'exam-package-test-')); t.after(()=>rm(r,{recursive:true,force:true}));
  for(const d of ['src','public/assets/fonts','public/assets/icons','config','var','.agents','.git'])await mkdir(join(r,d),{recursive:true});
  for(const [f,v] of [['src/app.js','// mock'],['package.json','{"engines":{"node":">=22.12.0"}}'],['.env.example','MODEL_PROVIDER=mock'],['.env','REAL_SECRET'],['var/private.json','history'],['.agents/private','rules'],['public/assets/fonts/OFL.txt','license'],['public/assets/icons/LICENSE','MIT'],['config/task.json','{}']])await writeFile(join(r,f),v);
  return r;
}
test('source bundle is append-only, includes licenses/env example, excludes secret/history; extracted checksums verify',async(t)=>{
  const r=await root(t),bundle=await createSourceBundle({root:r,context:{commit:'candidate'},secrets:['REAL_SECRET']});
  assert.ok(bundle.manifest.files.some(f=>f.name==='.env.example'));
  assert.ok(bundle.manifest.files.some(f=>f.name==='public/assets/fonts/OFL.txt'));
  assert.ok(bundle.manifest.files.some(f=>f.name==='public/assets/icons/LICENSE'));
  assert.ok(bundle.manifest.files.every(f=>!f.name.startsWith('var/')&&!f.name.startsWith('.agents/')&&f.name!=='.env'));
  const restored=await extractBundle(bundle); t.after(()=>rm(restored,{recursive:true,force:true}));
  assert.equal((await verifyBundle(restored)).status,'PASS');
  await writeFile(join(restored,'src/app.js'),'changed');assert.equal((await verifyBundle(restored)).status,'FAIL');
  assert.equal(await readFile(join(r,'.env'),'utf8'),'REAL_SECRET');
  const next=await createSourceBundle({root:r,context:{commit:'candidate'}});assert.notEqual(next.directory,bundle.directory);
});
test('packager refuses actual credential in included source and linked directories',async(t)=>{
  const r=await root(t);await writeFile(join(r,'src/leak.js'),'REAL_SECRET');
  await assert.rejects(createSourceBundle({root:r,context:{},secrets:['REAL_SECRET']}),/credential/i);
  await rm(join(r,'src/leak.js'));await symlink(join(r,'var'),join(r,'src/linked'),'junction');
  await assert.rejects(createSourceBundle({root:r,context:{}}),/link/i);
});
