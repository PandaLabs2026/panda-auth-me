import {spawn} from 'node:child_process';
import {pathToFileURL} from 'node:url';

/** 组织包装的依赖安装入口(容量预检由 deps:ci/deps:install 在本脚本之前执行,
 *  此处不绕过任何门禁)。`npm run` 会把 npm 配置以 npm_config_* 环境变量导出给
 *  脚本:全局 ~/.npmrc 的 allow-scripts 项会泄漏给子 `npm install`,而环境变量
 *  优先级高于项目 .npmrc(项目侧无法抵消),npm 12 在项目级安装中拒绝该旗标
 *  形式并报 EALLOWSCRIPTS。这里在派生前剥离该泄漏变量,其余环境原样传递。 */
export function sanitizedDepsEnv(env = process.env) {
  const clean = {...env};
  for (const key of Object.keys(clean)) {
    if (/^npm_config_allow[-_]scripts$/i.test(key)) delete clean[key];
  }
  return clean;
}

function main() {
  const command = process.argv[2];
  if (command !== 'install' && command !== 'ci') {
    console.error('usage: node scripts/deps.mjs <install|ci>');
    process.exit(2);
  }
  // Windows: node 对 .cmd 派生要求 shell(CVE-2024-27980 后的强制行为);
  // 参数仅限 install/ci 白名单,无注入面。
  const child = spawn('npm', [command], {
    stdio: 'inherit',
    env: sanitizedDepsEnv(),
    shell: process.platform === 'win32',
  });
  child.on('error', error => { console.error(error.message); process.exit(1); });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    else process.exit(code ?? 1);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
