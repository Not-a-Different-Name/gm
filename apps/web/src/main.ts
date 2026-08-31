import { createWorldMetadata } from '@gm/core';

import './style.css';

const defaultSeed = 'gm-first-world';
const metadata = createWorldMetadata(defaultSeed, '0.1.0');
const app = document.querySelector<HTMLElement>('#app');

if (app === null) {
  throw new Error('找不到游戏根节点');
}

app.innerHTML = `
  <section class="welcome-panel">
    <p class="eyebrow">GM · 开发中</p>
    <h1>可扩展的方块世界</h1>
    <p>世界核心已就绪。下一步将接入区块生成、渲染和玩家控制。</p>
    <dl>
      <div><dt>默认种子</dt><dd>${metadata.seed}</dd></div>
      <div><dt>世界格式</dt><dd>v${metadata.formatVersion}</dd></div>
    </dl>
  </section>
`;
