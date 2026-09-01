import { BlockId, createWorldMetadata } from '@gm/core';
import { describe, expect, it } from 'vitest';

import {
  SaveFormatError,
  classifySaveError,
  migrateWorldData,
  parseWorldFile,
  serializeWorld
} from './world-format.js';
import type { StoredWorld } from './world-storage.js';

// 合法 v1 存档的基样:各用例在其上覆盖破坏字段(返回可写类型便于破坏)。
type Mutable<Type> = { -readonly [Key in keyof Type]: Type[Key] };

function makeWorld(overrides: Partial<StoredWorld> = {}): Mutable<StoredWorld> {
  return {
    id: 'test-world',
    name: '我的世界',
    metadata: createWorldMetadata('12345', '0.1.0'),
    player: {
      x: 10.5,
      y: 64,
      z: -3,
      inventory: [{ blockId: BlockId.Stone, count: 7 }]
    },
    chunks: [
      {
        x: 0,
        z: 0,
        changes: [{ index: 5, blockId: BlockId.Dirt }]
      }
    ],
    updatedAt: 1756700000000,
    ...overrides
  };
}

describe('serializeWorld / parseWorldFile 往返', () => {
  it('全字段序列化后解析还原', () => {
    const world = makeWorld();
    const parsed = parseWorldFile(serializeWorld(world));
    expect(parsed).toEqual(world);
  });

  it('name 与 inventory 缺省时解析后保持 undefined', () => {
    // JSON.stringify 会省略值为 undefined 的字段,等价于旧存档缺字段。
    const world = makeWorld();
    const minimal = {
      ...world,
      name: undefined,
      player: { ...world.player, inventory: undefined }
    };
    const parsed = parseWorldFile(serializeWorld(minimal));
    expect(parsed.name).toBeUndefined();
    expect(parsed.player.inventory).toBeUndefined();
  });
});

describe('parseWorldFile 错误归类', () => {
  it('非 JSON 文本归为 invalid-json', () => {
    expect(() => parseWorldFile('不是 json')).toThrowError(SaveFormatError);
    try {
      parseWorldFile('{ 不闭合');
    } catch (error) {
      expect(error).toBeInstanceOf(SaveFormatError);
      expect((error as SaveFormatError).reason).toBe('invalid-json');
    }
  });

  it('JSON 语法错误同样归为 invalid-json', () => {
    try {
      parseWorldFile('{ "id": }');
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SaveFormatError);
      expect((error as SaveFormatError).reason).toBe('invalid-json');
    }
  });
});

describe('migrateWorldData 结构校验', () => {
  it('顶层不是对象归为 corrupted', () => {
    for (const raw of [null, 42, 'text', []]) {
      expect(() => migrateWorldData(raw)).toThrowError(SaveFormatError);
      try {
        migrateWorldData(raw);
      } catch (error) {
        expect((error as SaveFormatError).reason).toBe('corrupted');
      }
    }
  });

  it('缺少 id / updatedAt / metadata / player / chunks 均归为 corrupted', () => {
    const cases: Array<[string, unknown]> = [
      ['id', { ...makeWorld(), id: '' }],
      ['id', { ...makeWorld(), id: undefined }],
      ['updatedAt', { ...makeWorld(), updatedAt: undefined }],
      ['metadata', { ...makeWorld(), metadata: undefined }],
      ['player', { ...makeWorld(), player: undefined }],
      ['chunks', { ...makeWorld(), chunks: undefined }]
    ];
    for (const [label, raw] of cases) {
      try {
        migrateWorldData(raw);
        expect.unreachable(`缺少 ${label} 应报 corrupted`);
      } catch (error) {
        expect(error).toBeInstanceOf(SaveFormatError);
        expect((error as SaveFormatError).reason).toBe('corrupted');
      }
    }
  });

  it('玩家坐标无效归为 corrupted', () => {
    const world = makeWorld();
    world.player = { ...world.player, x: Number.NaN };
    try {
      migrateWorldData(world);
      expect.unreachable();
    } catch (error) {
      expect((error as SaveFormatError).reason).toBe('corrupted');
    }
  });

  it('物品栏条目缺 blockId 或 count 归为 corrupted', () => {
    const world = makeWorld();
    // 故意缺 count:绕过类型检查构造坏数据。
    world.player = {
      x: 0,
      y: 0,
      z: 0,
      inventory: [{ blockId: 1, count: 2 }, { blockId: 3 }] as never
    };
    try {
      migrateWorldData(world);
      expect.unreachable();
    } catch (error) {
      expect((error as SaveFormatError).reason).toBe('corrupted');
    }
  });

  it('区块差异缺 changes 或修改记录 index 非数字归为 corrupted', () => {
    const missingChanges = makeWorld();
    missingChanges.chunks = [{ x: 0, z: 0, changes: undefined }] as never;
    const badIndex = makeWorld();
    badIndex.chunks = [{ x: 0, z: 0, changes: [{ index: 'top', blockId: 1 }] } as never];
    for (const raw of [missingChanges, badIndex]) {
      try {
        migrateWorldData(raw);
        expect.unreachable();
      } catch (error) {
        expect((error as SaveFormatError).reason).toBe('corrupted');
      }
    }
  });

  it('formatVersion 高于当前版本归为 too-new', () => {
    const world = makeWorld();
    world.metadata = { ...world.metadata, formatVersion: 99 };
    try {
      migrateWorldData(world);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(SaveFormatError);
      expect((error as SaveFormatError).reason).toBe('too-new');
    }
  });

  it('formatVersion 低于当前版本且无对应迁移归为 corrupted', () => {
    const world = makeWorld();
    world.metadata = { ...world.metadata, formatVersion: 0 };
    try {
      migrateWorldData(world);
      expect.unreachable();
    } catch (error) {
      expect((error as SaveFormatError).reason).toBe('corrupted');
    }
  });
});

describe('classifySaveError 保存失败分类', () => {
  it('QuotaExceededError 归为 quota', () => {
    const quotaError = new DOMException('容量不足', 'QuotaExceededError');
    expect(classifySaveError(quotaError)).toBe('quota');
  });

  it('其余错误归为 other', () => {
    expect(classifySaveError(new Error('磁盘损坏'))).toBe('other');
    expect(classifySaveError(undefined)).toBe('other');
  });
});
