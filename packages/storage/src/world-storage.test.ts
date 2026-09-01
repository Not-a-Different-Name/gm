import { BlockId, createWorldMetadata } from '@gm/core';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import type { ModFingerprint } from '@gm/core';

import { SaveFormatError } from './world-format.js';
import { WorldStorage, hasMatchingMods } from './world-storage.js';
import type { StoredWorld } from './world-storage.js';

// 每个用例换全新的 IndexedDB 工厂和 WorldStorage 实例,避免测试间数据串味。
let storage: WorldStorage;

beforeEach(() => {
  globalThis.indexedDB = new IDBFactory() as unknown as IDBFactory;
  storage = new WorldStorage();
});

// 合法存档基样:返回可写类型,便于个别用例覆盖字段构造破坏数据。
type Mutable<Type> = { -readonly [Key in keyof Type]: Type[Key] };

function makeWorld(overrides: Partial<StoredWorld> = {}): Mutable<StoredWorld> {
  return {
    id: 'test-world',
    name: '我的世界',
    metadata: createWorldMetadata('12345', '0.1.0'),
    player: { x: 0, y: 64, z: 0 },
    chunks: [],
    updatedAt: 1756700000000,
    ...overrides
  };
}

describe('存档模组校验', () => {
  it('要求模组 ID、版本和哈希一致', () => {
    const mods: ModFingerprint[] = [{ id: 'example:trees', version: '1.0.0', hash: 'abc' }];

    expect(hasMatchingMods(mods, mods)).toBe(true);
    expect(hasMatchingMods(mods, [{ id: 'example:trees', version: '1.0.0', hash: 'def' }])).toBe(
      false
    );
  });
});

describe('WorldStorage 存取', () => {
  it('saveWorld 后 loadWorld 还原,不存在的存档返回 undefined', async () => {
    const world = makeWorld();
    await storage.saveWorld(world);
    await expect(storage.loadWorld(world.id)).resolves.toEqual(world);
    await expect(storage.loadWorld('不存在')).resolves.toBeUndefined();
  });

  it('listWorlds 按种子过滤,同一种子按 updatedAt 降序', async () => {
    await storage.saveWorld(makeWorld({ id: 'a', updatedAt: 100 }));
    await storage.saveWorld(makeWorld({ id: 'b', updatedAt: 300 }));
    await storage.saveWorld(makeWorld({ id: 'c', updatedAt: 200 }));
    await storage.saveWorld(
      makeWorld({
        id: 'other-seed',
        metadata: createWorldMetadata('别的种子', '0.1.0'),
        updatedAt: 999
      })
    );
    const listed = await storage.listWorlds('12345');
    expect(listed.map((world) => world.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('WorldStorage 删除与重命名', () => {
  it('deleteWorld 删除后 loadWorld 返回 undefined,重复删除静默', async () => {
    const world = makeWorld();
    await storage.saveWorld(world);
    await storage.deleteWorld(world.id);
    await expect(storage.loadWorld(world.id)).resolves.toBeUndefined();
    await expect(storage.deleteWorld(world.id)).resolves.toBeUndefined();
  });

  it('renameWorld 改名称且 updatedAt 不变', async () => {
    const world = makeWorld();
    await storage.saveWorld(world);
    await storage.renameWorld(world.id, '新名字');
    const renamed = await storage.loadWorld(world.id);
    expect(renamed?.name).toBe('新名字');
    expect(renamed?.updatedAt).toBe(world.updatedAt);
    expect(renamed?.chunks).toEqual(world.chunks);
  });

  it('renameWorld 不存在的存档静默返回', async () => {
    await expect(storage.renameWorld('不存在', '名字')).resolves.toBeUndefined();
  });
});

describe('WorldStorage 数据校验', () => {
  it('loadWorld 对损坏数据抛 SaveFormatError', async () => {
    // 绕过 saveWorld 的类型检查直接写入坏记录,模拟被外部改坏或旧版本遗留的数据。
    await storage.saveWorld({ id: 'broken', junk: true } as unknown as StoredWorld);
    await expect(storage.loadWorld('broken')).rejects.toBeInstanceOf(SaveFormatError);
  });

  it('loadWorld 对过新格式版本抛 too-new', async () => {
    const world = makeWorld();
    world.metadata = { ...world.metadata, formatVersion: 99 };
    await storage.saveWorld(world);
    await expect(storage.loadWorld(world.id)).rejects.toThrowError(SaveFormatError);
    try {
      await storage.loadWorld(world.id);
      expect.unreachable();
    } catch (error) {
      expect((error as SaveFormatError).reason).toBe('too-new');
    }
  });

  it('saveWorld 成功写入的 BlockId 数据原样保留', async () => {
    const world = makeWorld({
      player: { x: 1.5, y: 2, z: 3, inventory: [{ blockId: BlockId.Stone, count: 9 }] },
      chunks: [{ x: -1, z: 2, changes: [{ index: 4, blockId: BlockId.Water }] }]
    });
    await storage.saveWorld(world);
    await expect(storage.loadWorld(world.id)).resolves.toEqual(world);
  });
});
