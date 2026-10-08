import { fileURLToPath } from 'node:url';
import { scaffoldCli, printScaffoldError } from '../src/scaffold/cli.js';
const root = fileURLToPath(new URL('../', import.meta.url));
try { await scaffoldCli(root, process.argv.slice(2)); } catch (error) { printScaffoldError(root, error); }
