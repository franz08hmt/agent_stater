import { loadEnvironment } from '../src/operations/context.js';
import { runSuite, parseSuiteOptions, selectCases } from '../src/operations/suite.js';
import { SMOKE_CASES, REHEARSAL_CASES } from '../src/operations/cases.js';
import { saveReport } from '../src/operations/reports.js';
try {
  const args = process.argv.slice(2), rehearsal = args.includes('--rehearsal');
  const cases = rehearsal ? REHEARSAL_CASES : SMOKE_CASES;
  const options = parseSuiteOptions(args.filter((a) => a !== '--rehearsal'), cases), env = await loadEnvironment();
  const report = await saveReport(env, rehearsal ? 'rehearsal' : 'smoke', await runSuite({ env, ...options, cases: selectCases(cases, options.only) }));
  for (const r of report.results) console.log(`${r.status.padEnd(15)} ${r.id} #${r.trial} ${r.failure_code || r.reason}`);
  console.log(`Report ID: ${report.report_id}. HTTP ${report.session.provider_requests}/${report.session.limit}; script ${report.elapsed_ms} ms; demo-ready cases: ${report.demo_ready_cases.join(', ') || 'none'}.`);
  console.log('Student adaptation time: not measured. All trials, including failures, remain in the report.');
  process.exitCode = report.status === 'PASS' ? 0 : report.status === 'FAIL' ? 1 : 3;
} catch (err) { console.error(`Smoke blocked: ${err.message}`); process.exitCode = 2; }
