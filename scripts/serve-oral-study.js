import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { createStudyServer } from './study/server.js';

const args = process.argv.slice(2);
if (args.some(arg => arg !== '--lan' && !/^--port=\d+$/.test(arg))) throw new Error('Use --lan and/or --port=8890.');
const port = Number(args.find(arg => arg.startsWith('--port='))?.slice(7) ?? 8890);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Port must be 1024–65535.');
const lan = args.includes('--lan');
const html = await readFile(new URL('../docs/ORAL_EXAM_STUDY.html', import.meta.url), 'utf8');
const server = createStudyServer(html);
server.on('error', error => { console.error(`Study server: ${error.code || error.message}; no process was killed.`); process.exitCode = 1; });
server.listen(port, lan ? '0.0.0.0' : '127.0.0.1', () => {
  console.log(`Study document only: http://127.0.0.1:${port}/`);
  if (lan) {
    for (const entries of Object.values(networkInterfaces())) for (const entry of entries ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) console.log(`Phone (same trusted Wi-Fi): http://${entry.address}:${port}/`);
    }
    console.log('Private network only. No agent API, credentials or runtime data served. Firewall unchanged.');
  }
  console.log('Ctrl+C stops this document server.');
});
