import { showToast } from './toast.js';

// 显示器全屏(Fullscreen API):全屏下浏览器界面隐藏,进一步避免右键手势软件
// 与浏览器边缘操作打断游戏。手动切换按钮 + 按钮文案随状态同步(含 ESC 原生退出)。
// 全屏不跨页面刷新保持(浏览器要求用户手势重新授权),重新进入需再点按钮。

export function toggleFullscreen(): void {
  if (!document.fullscreenEnabled) {
    showToast('此浏览器不支持全屏', 'error');
    return;
  }
  if (document.fullscreenElement !== null) {
    document.exitFullscreen().catch(() => showToast('无法退出全屏', 'error'));
  } else {
    document.documentElement.requestFullscreen().catch(() => showToast('无法进入全屏', 'error'));
  }
}

// 所有全屏按钮统一显示当前可执行的动作(进入/退出)。
export function syncFullscreenButtons(): void {
  const label = document.fullscreenElement === null ? '进入全屏' : '退出全屏';
  document.querySelectorAll<HTMLButtonElement>('.fullscreen-toggle').forEach((button) => {
    button.textContent = label;
  });
}

export function initFullscreen(): void {
  // ESC 原生退出全屏也走这里,按钮文案与状态保持同步。
  document.addEventListener('fullscreenchange', syncFullscreenButtons);
  syncFullscreenButtons();
}
