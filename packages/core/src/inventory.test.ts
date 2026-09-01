import { describe, expect, it } from 'vitest';

import { BlockId } from './block.js';
import { Inventory, type InventoryEntry } from './inventory.js';

describe('Inventory 基础计数', () => {
  it('初始所有方块数量为 0', () => {
    const inventory = new Inventory();
    for (const blockId of [BlockId.Grass, BlockId.Dirt, BlockId.Stone, BlockId.Water]) {
      expect(inventory.count(blockId)).toBe(0);
    }
  });

  it('add 累加数量，负数量与 0 被忽略', () => {
    const inventory = new Inventory();
    inventory.add(BlockId.Grass, 3);
    inventory.add(BlockId.Grass, 2);
    expect(inventory.count(BlockId.Grass)).toBe(5);
    inventory.add(BlockId.Grass, -2);
    inventory.add(BlockId.Grass, 0);
    expect(inventory.count(BlockId.Grass)).toBe(5);
  });

  it('空气不可计数', () => {
    const inventory = new Inventory();
    inventory.add(BlockId.Air, 1);
    expect(inventory.count(BlockId.Air)).toBe(0);
    expect(inventory.canPlace(BlockId.Air)).toBe(false);
  });
});

describe('Inventory 放置与消耗', () => {
  it('canPlace：持有数量大于 0 可放、0 不可放、水恒可放', () => {
    const inventory = new Inventory();
    expect(inventory.canPlace(BlockId.Grass)).toBe(false);
    inventory.add(BlockId.Grass, 1);
    expect(inventory.canPlace(BlockId.Grass)).toBe(true);
    expect(inventory.canPlace(BlockId.Water)).toBe(true);
  });

  it('tryConsume：成功扣 1 返回 true；0 时不扣返回 false；水返回 true 且不扣', () => {
    const inventory = new Inventory();
    expect(inventory.tryConsume(BlockId.Grass)).toBe(false);
    inventory.add(BlockId.Grass, 2);
    expect(inventory.tryConsume(BlockId.Grass)).toBe(true);
    expect(inventory.count(BlockId.Grass)).toBe(1);
    expect(inventory.tryConsume(BlockId.Grass)).toBe(true);
    expect(inventory.count(BlockId.Grass)).toBe(0);
    expect(inventory.tryConsume(BlockId.Water)).toBe(true);
    expect(inventory.count(BlockId.Water)).toBe(0);
  });

  it('add 后 canPlace/tryConsume 组合流：拾取→放置→耗尽', () => {
    const inventory = new Inventory();
    inventory.add(BlockId.Stone, 1);
    expect(inventory.canPlace(BlockId.Stone)).toBe(true);
    expect(inventory.tryConsume(BlockId.Stone)).toBe(true);
    expect(inventory.canPlace(BlockId.Stone)).toBe(false);
    expect(inventory.tryConsume(BlockId.Stone)).toBe(false);
  });
});

describe('Inventory 水特例', () => {
  it('水恒不计数：add 后 count 仍为 0', () => {
    const inventory = new Inventory();
    inventory.add(BlockId.Water, 5);
    expect(inventory.count(BlockId.Water)).toBe(0);
    expect(inventory.toEntries()).toEqual([]);
  });
});

describe('Inventory 序列化', () => {
  it('toEntries 按 blockId 升序且只含数量大于 0 的方块', () => {
    const inventory = new Inventory();
    inventory.add(BlockId.Stone, 3);
    inventory.add(BlockId.Grass, 2);
    inventory.tryConsume(BlockId.Stone);
    expect(inventory.toEntries()).toEqual([
      { blockId: BlockId.Grass, count: 2 },
      { blockId: BlockId.Stone, count: 2 }
    ]);
  });

  it('toEntries 确定性：两次结果逐项相等', () => {
    const inventory = new Inventory();
    inventory.add(BlockId.Grass, 2);
    inventory.add(BlockId.Dirt, 5);
    inventory.add(BlockId.Stone, 1);
    expect(inventory.toEntries()).toEqual(inventory.toEntries());
  });

  it('fromEntries 正常恢复数量', () => {
    const entries: InventoryEntry[] = [
      { blockId: BlockId.Grass, count: 4 },
      { blockId: BlockId.Wood, count: 1 }
    ];
    const inventory = Inventory.fromEntries(entries);
    expect(inventory.count(BlockId.Grass)).toBe(4);
    expect(inventory.count(BlockId.Wood)).toBe(1);
  });

  it('fromEntries 防御过滤：空气/水/数量非法/未知 ID/null 条目全部跳过', () => {
    const entries: InventoryEntry[] = [
      { blockId: BlockId.Air, count: 3 },
      { blockId: BlockId.Water, count: 3 },
      { blockId: BlockId.Dirt, count: 0 },
      { blockId: BlockId.Dirt, count: 1.5 },
      { blockId: 99 as BlockId, count: 2 },
      null as unknown as InventoryEntry,
      { blockId: BlockId.Stone, count: 2 }
    ];
    const inventory = Inventory.fromEntries(entries);
    expect(inventory.count(BlockId.Stone)).toBe(2);
    expect(inventory.count(BlockId.Dirt)).toBe(0);
    expect(inventory.toEntries()).toEqual([{ blockId: BlockId.Stone, count: 2 }]);
  });

  it('fromEntries 传入 undefined 得到空物品栏', () => {
    const inventory = Inventory.fromEntries(undefined);
    expect(inventory.toEntries()).toEqual([]);
    expect(Inventory.fromEntries([]).toEntries()).toEqual([]);
  });
});

describe('Inventory 数量上限', () => {
  it('数量不做钳制，超大数量原样保留（显示层再处理 999+）', () => {
    const inventory = new Inventory();
    inventory.add(BlockId.Grass, 1500);
    expect(inventory.count(BlockId.Grass)).toBe(1500);
    expect(inventory.toEntries()).toEqual([{ blockId: BlockId.Grass, count: 1500 }]);
  });
});
