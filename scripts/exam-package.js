import { relative } from 'node:path';
import { loadEnvironment } from '../src/operations/context.js';
import { createSourceBundle } from '../src/operations/package.js';
try {
  if(process.argv.length!==2)throw new Error('exam:package accepts no path/endpoint overrides.');
  const env=await loadEnvironment();
  if(env.evidenceContext.working_tree_modified)throw new Error('Commit candidate changes before packaging; .agents untracked is excluded.');
  const bundle=await createSourceBundle({root:env.root,context:env.evidenceContext,secrets:[...env.catalog.profiles.values()].map(p=>p.config.apiKey)});
  console.log(JSON.stringify({status:'PASS',commit:bundle.manifest.commit,directory:relative(env.root,bundle.directory),...bundle.artifact,restore_verification:'NOT_RUN'},null,2));
}catch(error){console.error(`Package blocked: ${error.message}`);process.exitCode=2;}
