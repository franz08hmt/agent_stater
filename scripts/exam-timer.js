import { loadEnvironment } from '../src/operations/context.js';
import { beginTiming, markTiming, readTiming, TIMING_STEPS } from '../src/operations/timing.js';

try {
  const args = process.argv.slice(2), action = args.shift(), opts = {};
  for (const arg of args) {
    const match = arg.match(/^--(task|actor|id|step|event|note)=(.*)$/s);
    if (!match || Object.hasOwn(opts, match[1])) throw new Error('Unknown or duplicate timer option.'); opts[match[1]] = match[2];
  }
  const env = await loadEnvironment(); let result;
  if (action === 'begin') result = await beginTiming(env, { taskId: opts.task, actor: opts.actor });
  else if (action === 'mark') result = await markTiming(env, opts.id, { step: opts.step, event: opts.event, note: opts.note });
  else if (action === 'show') result = await readTiming(env, opts.id);
  else throw new Error(`Use begin --task=ID, mark --id=ID --step=<${TIMING_STEPS.join('|')}> --event=start|end --note=TEXT, or show --id=ID.`);
  console.log(JSON.stringify(result, null, 2));
} catch (err) { console.error(`Timing blocked: ${err.message}`); process.exitCode = 2; }
