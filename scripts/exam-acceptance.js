import { fileURLToPath } from 'node:url';
import { acceptanceCli, printScaffoldError } from '../src/scaffold/cli.js';
const root = fileURLToPath(new URL('../', import.meta.url));
try { await acceptanceCli(root, process.argv.slice(2)); } catch (error) { printScaffoldError(root, error); }
