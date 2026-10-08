import { readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { loadEnvironment } from '../src/operations/context.js';
import { extractBundle, verifyBundle } from '../src/operations/package.js';
import { saveReport } from '../src/operations/reports.js';
let restored;
try {
  const arg=process.argv[2];if(process.argv.length!==3||!/^--id=exam-source-[0-9a-f-]{36}$/.test(arg??''))throw new Error('Use --id=exam-source-<UUID>, printed by exam:package.');
  const env=await loadEnvironment(),directory=join(env.root,'var/packages',arg.slice(5));
  const artifact=JSON.parse(await readFile(join(directory,'artifact-manifest.json'),'utf8'));
  restored=await extractBundle({zip:join(directory,'ai-agent-starter.zip'),artifact});
  const checksum=await verifyBundle(restored);if(checksum.status!=='PASS')throw new Error('Restored file checksum failed.');
  const execution=await promisify(execFile)(process.execPath,['scripts/restored-smoke.js'],{cwd:restored,env:{...process.env,MODEL_PROVIDER:'mock',MODEL_NAME:'rule-based-mock',MODEL_API_KEY:''},windowsHide:true,timeout:60000,maxBuffer:1024*1024});
  const smoke=JSON.parse(execution.stdout.trim());if(smoke.status!=='PASS')throw new Error('Restored smoke failed.');
  const report=await saveReport(env,'restore',{status:'PASS',artifact_id:arg.slice(5),archive_commit:artifact.commit,sha256:artifact.sha256,checksums:checksum,verification:smoke});
  await writeFile(join(directory,`restore-${report.report_id}.json`),JSON.stringify(report,null,2),{flag:'wx'});
  console.log(JSON.stringify(report,null,2));
} catch(error){console.error(`Restore check failed: ${error.message}`);process.exitCode=2;}
finally{if(restored){if(!restored.startsWith(join(tmpdir(),'agent-exam-restored-')))throw new Error('Unsafe cleanup');await rm(restored,{recursive:true,force:true});}}
