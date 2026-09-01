import { BLOCK_DEFINITIONS, BlockId } from './block.js';

export interface InventoryEntry {
  readonly blockId: BlockId;
  readonly count: number;
}

/**
 * 玩家物品栏：按方块统计持有数量（掉落+拾取+消耗，参考我的世界）。
 * 水是低级方块、可被填充：不计入物品栏、恒可放置、放置不消耗（热键栏显示 ∞）。
 * 空气不是物品，不可计数也不可放置。
 */
export class Inventory {
  private readonly counts = new Map<BlockId, number>();

  /** 某方块的持有数量；水恒为 0（不计数，由 UI 显示 ∞）。 */
  public count(blockId: BlockId): number {
    if (blockId === BlockId.Water) {
      return 0;
    }
    return this.counts.get(blockId) ?? 0;
  }

  /** 增加持有数量；非正整数、空气与水一律忽略。 */
  public add(blockId: BlockId, amount = 1): void {
    if (blockId === BlockId.Air || blockId === BlockId.Water) {
      return;
    }
    if (!Number.isInteger(amount) || amount <= 0) {
      return;
    }
    this.counts.set(blockId, this.count(blockId) + amount);
  }

  /** 是否可放置：持有至少 1 个即可；水恒可放；空气不可放。 */
  public canPlace(blockId: BlockId): boolean {
    if (blockId === BlockId.Water) {
      return true;
    }
    if (blockId === BlockId.Air) {
      return false;
    }
    return this.count(blockId) > 0;
  }

  /** 放置时消耗 1 个；不可放时返回 false 不扣减；水恒返回 true 且不扣。 */
  public tryConsume(blockId: BlockId): boolean {
    if (!this.canPlace(blockId)) {
      return false;
    }
    if (blockId === BlockId.Water) {
      return true;
    }
    const remaining = this.count(blockId) - 1;
    if (remaining > 0) {
      this.counts.set(blockId, remaining);
    } else {
      this.counts.delete(blockId);
    }
    return true;
  }

  /** 序列化为存档条目：blockId 升序保证确定性，只含持有数量大于 0 的方块。 */
  public toEntries(): InventoryEntry[] {
    return [...this.counts.entries()]
      .filter(([, count]) => count > 0)
      .map(([blockId, count]) => ({ blockId, count }))
      .sort((left, right) => left.blockId - right.blockId);
  }

  /** 从存档条目恢复；防御性过滤非法数据，旧档缺省（undefined）得到空物品栏。 */
  public static fromEntries(entries: readonly InventoryEntry[] | undefined): Inventory {
    const inventory = new Inventory();
    if (entries === undefined || !Array.isArray(entries)) {
      return inventory;
    }
    // 存档数据可能损坏：按 unknown 逐条校验字段（空条目/非法数量/未知方块 ID）后再入包。
    for (const entry of entries as readonly unknown[]) {
      if (entry === null || typeof entry !== 'object') {
        continue;
      }
      const candidate = entry as Partial<InventoryEntry>;
      if (
        typeof candidate.blockId !== 'number' ||
        typeof candidate.count !== 'number' ||
        BLOCK_DEFINITIONS[candidate.blockId] === undefined
      ) {
        continue;
      }
      inventory.add(candidate.blockId, candidate.count);
    }
    return inventory;
  }
}
