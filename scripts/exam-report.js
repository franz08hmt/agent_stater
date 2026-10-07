import { loadEnvironment } from '../src/operations/context.js';
import { assessReadiness } from '../src/operations/readiness.js';
import { readReport, saveReport } from '../src/operations/reports.js';

try {
  const args = process.argv.slice(2);
  if (args.length > 1 || args.some((a) => !/^--(?:profile|id)=[a-z0-9-]+$/.test(a))) throw new Error('Use --profile=ID for a new readiness report or --id=ID to inspect saved evidence.');
  const env = await loadEnvironment(), id = args.find((a) => a.startsWith('--id='))?.slice(5);
  if (id) console.log(JSON.stringify(await readReport(env, id), null, 2));
  else {
    const profileId = args.find((a) => a.startsWith('--profile='))?.slice(10) ?? env.catalog.defaultProfileId;
    const report = await saveReport(env, 'readiness', await assessReadiness(env, { profileId }));
    console.log(JSON.stringify({ report_id: report.report_id, status: report.status, server: report.server, model: report.model, offline: report.offline,
      live_cases: report.live_cases, accounting: report.accounting, student_adaptation: report.student_adaptation }, null, 2));
    if (report.status !== 'PASS') process.exitCode = 3;
  }
} catch (err) { console.error(`Readiness blocked: ${err.message}`); process.exitCode = 2; }
