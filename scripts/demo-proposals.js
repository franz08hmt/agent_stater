import { loadEnvironment } from '../src/operations/context.js';
import { runProposalSuite, PROPOSAL_CASES } from '../src/operations/proposalSuite.js';
import { parseSuiteOptions, selectCases } from '../src/operations/suite.js';
import { saveReport } from '../src/operations/reports.js';
try {
  const options = parseSuiteOptions(process.argv.slice(2), PROPOSAL_CASES), env = await loadEnvironment();
  if (options.cloud) throw new Error('No cloud test in this proposal round.');
  const report = await saveReport(env, 'proposal-suite', await runProposalSuite({ env, ...options, cases: selectCases(PROPOSAL_CASES, options.only) }));
  for (const r of report.results) console.log(`${r.status} ${r.id} #${r.trial}: ${r.reason}`);
  console.log(`Report ID: ${report.report_id}; evidence ${report.model_evidence}; HTTP ${report.session.provider_requests}/${report.session.limit}.`);
  console.log('Internal proposals only; original datasets are unchanged. Scripted evidence does not verify a real LLM.');
  process.exitCode = report.status === 'PASS' ? 0 : report.status === 'FAIL' ? 1 : 3;
} catch (err) { console.error(`Proposal demo blocked: ${err.message}`); process.exitCode = 2; }
