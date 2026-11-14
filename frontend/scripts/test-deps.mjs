import test from 'node:test';
import assert from 'node:assert/strict';
import {sanitizedDepsEnv} from './deps.mjs';

// 回归:npm run 泄漏的 npm_config_allow-scripts(全局 ~/.npmrc allow-scripts 项)
// 必须在派生 npm install/ci 前剥离,否则 npm 12 项目级安装报 EALLOWSCRIPTS;
// 其余 npm_config_* 与普通环境变量原样保留。

test('sanitizedDepsEnv 剥离 allow-scripts 泄漏且仅剥离该变量', () => {
  const clean = sanitizedDepsEnv({
    npm_config_allow_scripts: '@anthropic-ai/claude-code',
    NPM_CONFIG_ALLOW_SCRIPTS: 'leak',
    npm_config_registry: 'https://registry.npmmirror.com',
    PATH: 'C:\\Windows\\System32',
  });
  assert.equal('npm_config_allow_scripts' in clean, false);
  assert.equal('NPM_CONFIG_ALLOW_SCRIPTS' in clean, false);
  assert.equal(clean.npm_config_registry, 'https://registry.npmmirror.com');
  assert.equal(clean.PATH, 'C:\\Windows\\System32');
});

test('sanitizedDepsEnv 不修改无泄漏的环境', () => {
  const env = {PATH: '/usr/bin', npm_config_proxy: 'http://127.0.0.1:7890'};
  assert.deepEqual(sanitizedDepsEnv(env), env);
});
