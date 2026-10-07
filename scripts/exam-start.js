import { loadEnvironment } from '../src/operations/context.js';
import { launchForeground } from '../src/operations/launcher.js';
try {
  const env = await loadEnvironment();
  const result = await launchForeground(env);
  if (result.exit_code) process.exitCode = result.exit_code;
} catch (err) { console.error(`Startup blocked: ${err.message}`); process.exitCode = 2; }
