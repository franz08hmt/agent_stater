import { loadEnvironment } from '../src/operations/context.js';
import { inspectLocalModel, warmProfile, localEndpoint } from '../src/operations/localModel.js';
import { probeProfile } from '../src/model/probe.js';
import { saveReport } from '../src/operations/reports.js';

try {
  const args = process.argv.slice(2), value = (key, fallback) => args.find((a) => a.startsWith(`--${key}=`))?.split('=').slice(1).join('=') ?? fallback;
  if (args.some((a) => !/^--(?:profile|action)=[a-z0-9-]+$/.test(a))) throw new Error('Use --profile=<catalog ID> --action=inspect|warm|probe.');
  const env = await loadEnvironment(), id = value('profile', env.catalog.defaultProfileId), action = value('action', 'inspect');
  const profile = env.catalog.profiles.get(id);
  if (!profile || !profile.model) throw new Error('Model profile is invalid or unavailable.');
  if (!['inspect', 'warm', 'probe'].includes(action)) throw new Error('Unknown model action.');
  let result;
  if (action === 'probe') { if (!profile.metadata.is_mock) localEndpoint(profile); result = await probeProfile(profile); }
  else {
    const inspection = await inspectLocalModel(profile);
    result = action === 'warm' && inspection.installed === true ? { inspection, ...await warmProfile(profile) } : inspection;
  }
  const status = result.error ? 'BLOCKED' : result.protocol_ok === false ? 'FAIL' : result.status ?? 'PASS';
  const report = await saveReport(env, action, { status, model_profile_id: id, result });
  console.log(JSON.stringify(report, null, 2));
  console.log(`Report ID: ${report.report_id}. Model response is separate from live case acceptance.`);
  if (status !== 'PASS') process.exitCode = 3;
} catch (err) { console.error(`Model check blocked: ${err.message}`); process.exitCode = 2; }
