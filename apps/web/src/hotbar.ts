import { BLOCK_DEFINITIONS, BlockId, type Inventory } from '@gm/core';
import { getTextureAtlas } from '@gm/renderer';

interface Slot {
  readonly element: HTMLButtonElement;
  readonly count: HTMLElement;
}

/**
 * 底部热键栏：每个可选方块一个槽，显示图集贴图图标与持有数量。
 * 水槽恒显 ∞（水不计入物品栏、恒可放置）；数量超过 999 压缩显示为 999+。
 */
export class Hotbar {
  public readonly element = document.createElement('div');
  private readonly slots: Slot[] = [];
  private readonly blockIds: readonly BlockId[];
  private readonly onSelect: (index: number) => void;
  private selectedIndex = 0;

  public constructor(
    selectableBlocks: readonly BlockId[],
    inventory: Inventory,
    onSelect: (index: number) => void
  ) {
    this.blockIds = selectableBlocks;
    this.onSelect = onSelect;
    this.element.className = 'hotbar';
    selectableBlocks.forEach((blockId, index) => {
      const slot = document.createElement('button');
      slot.type = 'button';
      slot.className = 'hotbar-slot';
      const icon = getTextureAtlas().copyTile(BLOCK_DEFINITIONS[blockId].textures.side, 0, 2);
      const count = document.createElement('span');
      count.className = 'hotbar-count';
      const key = document.createElement('span');
      key.className = 'hotbar-key';
      key.textContent = String(index + 1);
      slot.append(icon, count, key);
      slot.addEventListener('click', () => {
        this.select(index);
      });
      this.element.append(slot);
      this.slots.push({ element: slot, count });
    });
    this.refreshCounts(inventory);
    this.select(0);
  }

  public get selected(): number {
    return this.selectedIndex;
  }

  /** 选中某槽：更新高亮并回调（同步主循环的当前放置方块）。 */
  public select(index: number): void {
    this.selectedIndex = index;
    this.slots.forEach((slot, slotIndex) => {
      slot.element.classList.toggle('is-selected', slotIndex === index);
    });
    this.onSelect(index);
  }

  /** 用物品栏刷新所有槽的数量显示。 */
  public refreshCounts(inventory: Inventory): void {
    this.blockIds.forEach((blockId, index) => {
      const slot = this.slots[index];
      if (slot === undefined) {
        return;
      }
      const count = inventory.count(blockId);
      slot.count.textContent =
        blockId === BlockId.Water ? '∞' : count > 999 ? '999+' : String(count);
    });
  }

  public setVisible(visible: boolean): void {
    this.element.classList.toggle('is-hidden', !visible);
  }
}
