// 模态对话框:确认模式(可选危险红色确认钮)与单行输入模式(如重命名)。
// 确认时 resolve 输入值(确认模式 resolve 空串,调用方只区分 null 与非 null);
// 取消、Esc、点击遮罩一律 resolve null。同一时间只应打开一个对话框。

export interface DialogOptions {
  readonly title: string;
  readonly message?: string;
  /** 提供该字段即为输入模式:显示单行输入框,输入为空时禁用确认钮。 */
  readonly input?: {
    readonly label: string;
    readonly maxLength?: number;
    readonly value?: string;
  };
  readonly confirmText?: string;
  /** 危险操作:确认钮变红。 */
  readonly danger?: boolean;
}

export function showDialog(options: DialogOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const layer = document.createElement('div');
    layer.className = 'dialog-layer';
    const panel = document.createElement('div');
    panel.className = 'dialog-panel';

    const title = document.createElement('h2');
    title.textContent = options.title;
    panel.append(title);

    if (options.message !== undefined) {
      const message = document.createElement('p');
      message.textContent = options.message;
      panel.append(message);
    }

    let input: HTMLInputElement | undefined;
    if (options.input !== undefined) {
      const label = document.createElement('label');
      label.className = 'dialog-label';
      label.textContent = options.input.label;
      input = document.createElement('input');
      input.type = 'text';
      input.value = options.input.value ?? '';
      if (options.input.maxLength !== undefined) {
        input.maxLength = options.input.maxLength;
      }
      label.append(input);
      panel.append(label);
    }

    const actions = document.createElement('div');
    actions.className = 'dialog-actions';
    const confirmButton = document.createElement('button');
    confirmButton.type = 'button';
    confirmButton.className = 'dialog-confirm';
    confirmButton.textContent = options.confirmText ?? '确认';
    if (options.danger === true) {
      confirmButton.classList.add('is-danger');
    }
    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'dialog-cancel';
    cancelButton.textContent = '取消';
    actions.append(confirmButton, cancelButton);
    panel.append(actions);
    layer.append(panel);

    const refreshConfirm = (): void => {
      confirmButton.disabled = input !== undefined && input.value.trim().length === 0;
    };

    // 函数声明互相引用(finish ↔ onKeyDown),依赖提升语义,避免 const 的 TDZ 问题。
    let settled = false;
    function finish(value: string | null): void {
      if (settled) {
        return;
      }
      settled = true;
      layer.remove();
      document.removeEventListener('keydown', onKeyDown);
      resolve(value);
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        finish(null);
      }
    }

    refreshConfirm();
    input?.addEventListener('input', refreshConfirm);
    confirmButton.addEventListener('click', () => finish(input?.value ?? ''));
    cancelButton.addEventListener('click', () => finish(null));
    // 点击遮罩(而非面板)视为取消。
    layer.addEventListener('click', (event) => {
      if (event.target === layer) {
        finish(null);
      }
    });
    document.addEventListener('keydown', onKeyDown);
    document.body.append(layer);
    input?.focus();
  });
}
