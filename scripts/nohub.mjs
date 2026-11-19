import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createConnection } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(script), '..');
const runtime = path.join(root, '.runtime');
const pidFile = path.join(runtime, 'nohub.pid');
const logFile = path.join(runtime, 'nohub.log');
const action = process.argv[2] ?? 'start';

function managedPid() {
  if (!existsSync(pidFile)) return null;
  const pid = Number(readFileSync(pidFile, 'utf8').trim());
  if (!Number.isSafeInteger(pid) || pid <= 1) return null;
  const result = spawnSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' });
  return result.status === 0 && result.stdout.includes(script) && result.stdout.includes('--serve') ? pid : null;
}

async function reachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch { return false; }
}

async function portInUse(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    socket.setTimeout(1000);
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}

async function main() {
  if (action === '--serve') {
    const child = spawn('npm', ['run', 'dev'], { cwd: root, env: process.env, stdio: 'inherit' });
    child.once('error', (error) => { console.error(error); process.exitCode = 1; });
    child.once('exit', (code) => { process.exitCode = code ?? 1; });
    return;
  }
  if (!['start', 'stop', 'status'].includes(action)) throw new Error('用法：npm run nohub | nohub:stop | nohub:status');
  const pid = managedPid();
  if (action === 'status') {
    if (!pid) { console.log('Ample 后台服务未运行。'); return; }
    const web = await reachable('http://127.0.0.1:3010/');
    const api = await reachable('http://127.0.0.1:3001/api/notes');
    console.log(`Ample 后台进程 ${pid}：前端${web ? '正常' : '不可用'}，API${api ? '正常' : '不可用'}。日志：${logFile}`);
    if (!web || !api) process.exitCode = 1;
    return;
  }
  if (action === 'stop') {
    if (!pid) { console.log('Ample 后台服务未运行。'); return; }
    process.kill(-pid, 'SIGTERM');
    for (let i = 0; i < 50 && managedPid(); i++) await new Promise((resolve) => setTimeout(resolve, 100));
    if (managedPid()) throw new Error(`进程 ${pid} 尚未停止，请检查 ${logFile}`);
    rmSync(pidFile, { force: true });
    console.log('Ample 后台服务已停止；数据库保持运行。');
    return;
  }
  if (pid) {
    const web = await reachable('http://127.0.0.1:3010/');
    const api = await reachable('http://127.0.0.1:3001/api/notes');
    if (!web || !api) throw new Error(`后台进程 ${pid} 已运行，但服务不可用；请检查 ${logFile}。`);
    console.log(`Ample 已在后台运行（PID ${pid}）。`);
    return;
  }
  for (const port of [3010, 3001]) {
    if (await portInUse(port)) throw new Error(`端口 ${port} 已被占用；请先检查现有服务。`);
  }
  mkdirSync(runtime, { recursive: true });
  const log = openSync(logFile, 'a');
  const child = spawn(process.execPath, [script, '--serve'], { cwd: root, detached: true, env: process.env, stdio: ['ignore', log, log] });
  closeSync(log);
  await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
  if (!child.pid) throw new Error('无法获取后台进程 PID。');
  writeFileSync(pidFile, `${child.pid}\n`);
  child.unref();
  for (let i = 0; i < 60; i++) {
    if (!managedPid()) break;
    if (await reachable('http://127.0.0.1:3010/') && await reachable('http://127.0.0.1:3001/api/notes')) {
      console.log(`Ample 已启动（PID ${child.pid}）：http://127.0.0.1:3010/\n日志：${logFile}`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (managedPid()) process.kill(-child.pid, 'SIGTERM');
  rmSync(pidFile, { force: true });
  throw new Error(`Ample 启动失败或 API 无法连接数据库，请查看 ${logFile}`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
