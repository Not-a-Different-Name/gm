// 底部临时提示:堆叠显示,几秒后自动消失;信息与错误两种配色。
// 单例浮层,最后一个提示消失后移除整个浮层,不留残留 DOM。

type ToastKind = 'info' | 'error';

const TOAST_DURATION_MS = 3000;

let toastLayer: HTMLDivElement | undefined;

export function showToast(message: string, kind: ToastKind = 'info'): void {
  toastLayer ??= createToastLayer();
  const toast = document.createElement('div');
  toast.className = `toast toast--${kind}`;
  toast.textContent = message;
  toastLayer.append(toast);
  window.setTimeout(() => {
    toast.remove();
    if (toastLayer?.childElementCount === 0) {
      toastLayer.remove();
      toastLayer = undefined;
    }
  }, TOAST_DURATION_MS);
}

function createToastLayer(): HTMLDivElement {
  const layer = document.createElement('div');
  layer.className = 'toast-layer';
  document.body.append(layer);
  return layer;
}
