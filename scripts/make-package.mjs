/**
 * 生成可分享的五子棋压缩包：将页面、服务端、ws 依赖和对应平台 Node 运行时放入同一目录。
 * 用法：node scripts/make-package.mjs mac-arm64 [mac-x64|win-x64]
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const version = '22.14.0';
const targets = process.argv.slice(2).length ? process.argv.slice(2) : [`${process.platform === 'win32' ? 'win' : 'mac'}-${process.arch === 'arm64' ? 'arm64' : 'x64'}`];
const cache = path.join(root, '.runtime-cache');
const dist = path.join(root, 'dist');
fs.mkdirSync(cache, { recursive: true }); fs.mkdirSync(dist, { recursive: true });

/** @param {string} command @param {string[]} args @returns {void} 执行平台打包命令并在失败时抛出异常。 */
function run(command, args, cwd = root) { execFileSync(command, args, { cwd, stdio: 'inherit' }); }
/** @param {string} source @param {string} target @returns {void} 递归复制项目文件。 */
function copy(source, target) { fs.cpSync(source, target, { recursive: true, force: true }); }
/** @param {string} target @returns {string} 返回 Node.js 官方运行时压缩包地址。 */
function runtimePlatform(target) { return target === 'mac-arm64' ? 'darwin-arm64' : target === 'mac-x64' ? 'darwin-x64' : 'win-x64'; }
function runtimeUrl(target) { const platform = runtimePlatform(target); return `https://nodejs.org/dist/v${version}/node-v${version}-${platform}.` + (target.startsWith('win-') ? 'zip' : 'tar.gz'); }

for (const target of targets) {
  if (!['mac-arm64', 'mac-x64', 'win-x64'].includes(target)) throw new Error(`不支持的目标平台：${target}`);
  const packageName = `gomoku-party-${target}`;
  const stage = path.join(dist, packageName);
  fs.rmSync(stage, { recursive: true, force: true }); fs.mkdirSync(stage, { recursive: true });
  for (const file of ['server.js', 'package.json', 'package-lock.json', 'README.md']) copy(path.join(root, file), path.join(stage, file));
  copy(path.join(root, 'public'), path.join(stage, 'public'));
  copy(path.join(root, target.startsWith('win-') ? '启动五子棋.bat' : '启动五子棋.command'), path.join(stage, target.startsWith('win-') ? '启动五子棋.bat' : '启动五子棋.command'));
  run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--omit=dev', '--prefix', stage]);

  const archive = path.join(cache, path.basename(runtimeUrl(target)));
  if (!fs.existsSync(archive)) { console.log(`下载 Node.js ${target} 运行时…`); run('curl', ['-L', '--fail', '--retry', '2', '-o', archive, runtimeUrl(target)]); }
  const unpack = path.join(cache, `node-${target}`); fs.rmSync(unpack, { recursive: true, force: true }); fs.mkdirSync(unpack, { recursive: true });
  if (target.startsWith('win-')) run('unzip', ['-q', archive, '-d', unpack]); else run('tar', ['-xzf', archive, '-C', unpack]);
  const runtimeRoot = fs.readdirSync(unpack, { withFileTypes: true }).find((entry) => entry.isDirectory());
  const runtimeDir = path.join(stage, 'runtime'); fs.mkdirSync(runtimeDir, { recursive: true });
  const binary = target.startsWith('win-') ? path.join(unpack, runtimeRoot.name, 'node.exe') : path.join(unpack, runtimeRoot.name, 'bin', 'node');
  copy(binary, path.join(runtimeDir, target.startsWith('win-') ? 'node.exe' : 'node'));
  if (!target.startsWith('win-')) fs.chmodSync(path.join(runtimeDir, 'node'), 0o755);
  const zipName = path.join(dist, `${packageName}.zip`); fs.rmSync(zipName, { force: true });
  run('zip', ['-qr', zipName, packageName], dist);
  console.log(`已生成 ${zipName}`);
}
