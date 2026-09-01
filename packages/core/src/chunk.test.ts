import { describe, expect, it } from 'vitest';

import { BlockId } from './block.js';
import { Chunk } from './chunk.js';

describe('Chunk 修改记录', () => {
  it('setBlock 记录修改，clearChanges() 无参清空全部', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(0, 0, 0, BlockId.Grass);
    chunk.setBlock(1, 0, 0, BlockId.Dirt);
    expect(chunk.getChanges()).toHaveLength(2);
    chunk.clearChanges();
    expect(chunk.getChanges()).toEqual([]);
  });

  it('clearChanges(快照) 只删除与快照一致的条目，保存期间被改写的保留', () => {
    const chunk = new Chunk(0, 0);
    chunk.setBlock(0, 0, 0, BlockId.Grass);
    chunk.setBlock(1, 0, 0, BlockId.Dirt);
    const snapshot = chunk.getChanges();
    // 保存期间 (0,0,0) 被再次编辑成石头：新修改不能随保存快照一起清除。
    chunk.setBlock(0, 0, 0, BlockId.Stone);
    chunk.clearChanges(snapshot);
    expect(chunk.getChanges()).toEqual([{ index: 0, blockId: BlockId.Stone }]);
  });

  it('applyChanges 写入方块并把差异重新登记进修改记录', () => {
    const chunk = new Chunk(0, 0);
    chunk.applyChanges([{ index: 5, blockId: BlockId.Stone }]);
    expect(chunk.getBlock(5, 0, 0)).toBe(BlockId.Stone);
    expect(chunk.getChanges()).toEqual([{ index: 5, blockId: BlockId.Stone }]);
  });
});
