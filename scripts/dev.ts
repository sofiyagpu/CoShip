import { spawn } from 'node:child_process';
const children = ['dev:api', 'dev:web'].map(script => spawn('npm', ['run', script], { stdio: 'inherit', env: process.env }));
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; for (const child of children) child.kill('SIGTERM'); process.exitCode = code; }
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
children.forEach(child => child.on('exit', code => stop(code ?? 1)));
