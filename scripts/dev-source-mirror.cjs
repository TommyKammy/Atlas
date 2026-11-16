// Development-only bridge from read-only host sources to the container filesystem.
// Next.js receives native Linux events; dependencies, caches and data are excluded.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const roots = ['app', 'components', 'lib', 'public', 'scripts', 'db', 'next.config.ts', 'proxy.ts', 'tsconfig.json', 'package.json', 'package-lock.json', 'instrumentation.ts', 'server.js'];
if (process.cwd() !== '/app' || process.env.NODE_ENV !== 'development' || process.env.ATLAS_DEV_POLLING === '1') {
  throw new Error('Source mirror requires /app development mode with native Next.js watching');
}
const source = '/atlas-source';
let applied = new Map(), previousSignature, timer, child, stopping = false, missingSnapshots = 0;
function scan() {
  const files = new Map();
  function visit(relative) {
    const full = path.join(source, relative);
    const stat = fs.lstatSync(full);
    if (stat.isSymbolicLink()) throw new Error(`Source mirror rejects symlink: ${relative}`);
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(full).sort()) visit(path.join(relative, name));
    } else if (stat.isFile()) {
      const bytes = fs.readFileSync(full);
      files.set(relative, {bytes, hash: crypto.createHash('sha256').update(bytes).digest('hex'), mode: stat.mode & 0o777});
    } else throw new Error(`Unsupported source entry: ${relative}`);
  }
  for (const root of roots) visit(root);
  return files;
}
function signature(files) { return JSON.stringify([...files].map(([name, file]) => [name, file.hash, file.mode])); }
function apply(files, initial = false) {
  // Only the explicit application source roots in the disposable container layer.
  if (initial) for (const root of roots) fs.rmSync(path.join('/app', root), {recursive: true, force: true});
  for (const [name, file] of files) {
    if (applied.get(name)?.hash === file.hash && applied.get(name)?.mode === file.mode) continue;
    const target = path.join('/app', name);
    fs.mkdirSync(path.dirname(target), {recursive: true});
    const temp = target + '.atlas-sync-tmp';
    fs.writeFileSync(temp, file.bytes, {mode: file.mode});
    fs.chmodSync(temp, file.mode);
    fs.renameSync(temp, target);
  }
  for (const name of applied.keys()) if (!files.has(name)) fs.rmSync(path.join('/app', name), {force: true});
  applied = files;
}
function stop(signal = 'SIGTERM') {
  if (stopping) return;
  stopping = true; clearInterval(timer);
  if (child) child.kill(signal); else process.exitCode = 1;
}
process.on('SIGTERM', () => stop());
process.on('SIGINT', () => stop('SIGINT'));
apply(scan(), true);
console.log(`Atlas development source mirror ready (${applied.size} files; host read-only)`);
child = spawn(process.execPath, ['server.js'], {cwd: '/app', env: process.env, stdio: 'inherit'});
child.on('exit', (code, signal) => {clearInterval(timer); process.exitCode = code ?? (signal ? 1 : 0);});
timer = setInterval(() => {
  if (stopping) return;
  try {
    const files = scan(), current = signature(files);
    missingSnapshots = 0;
    // Wait for two identical snapshots, so an editor's partial save is not copied.
    if (current === previousSignature) apply(files);
    previousSignature = current;
  } catch (error) {
    if (error.code === 'ENOENT' && ++missingSnapshots < 10) {previousSignature = undefined; return;}
    console.error('Atlas development source mirror failed:', error);
    stop();
  }
}, 500);
