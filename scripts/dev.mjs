import { createServer } from 'vite';
import { spawn } from 'node:child_process';
import electron from 'electron';
const server = await createServer();
await server.listen();
server.printUrls();
const environment = {
  ...process.env,
  TO3MATO_DEV_URL: 'http://127.0.0.1:4173',
};
delete environment.ELECTRON_RUN_AS_NODE;
const child = spawn(electron, ['.'], { stdio: 'inherit', env: environment });
let closing = false;
async function close(code = 0) {
  if (closing) return;
  closing = true;
  child.kill();
  await server.close();
  process.exit(code);
}
child.on('exit', (code) => close(code || 0));
child.on('error', (error) => {
  console.error(error);
  close(1);
});
process.on('SIGINT', () => close());
process.on('SIGTERM', () => close());
