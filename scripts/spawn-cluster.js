import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const count = Number(process.argv[2] ?? 3);
if (!Number.isInteger(count) || count < 1) {
  console.error('usage: node scripts/spawn-cluster.js <count>');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const nodeScript = path.resolve(__dirname, '../src/exchange/index.js');

const children = [];
for (let i = 0; i < count; i++) {
  const child = fork(nodeScript, [], {
    env: { ...process.env }, // each child auto-generates its own SELF_ID
    execArgv: ['--env-file=.env'],
    stdio: 'inherit',
  });
  children.push(child);
}

const shutdown = () => {
  for (const c of children) {
    try {
      c.kill('SIGTERM');
    } catch {
      /* ignore */
    }
  }
  setTimeout(() => process.exit(0), 500);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

console.log(`[spawn-cluster] forked ${count} exchange nodes`);
