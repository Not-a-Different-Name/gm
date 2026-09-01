import { WORLD_FORMAT_VERSION } from '@gm/core';
import type { WorldMetadata } from '@gm/core';

import type { StoredChunkDelta, StoredPlayerState, StoredWorld } from './world-storage.js';

// 存档文件的序列化/校验/迁移:纯函数、不依赖 IndexedDB,node 环境可单测。
// 导出文件格式 = StoredWorld 的 JSON 结构(与 IndexedDB 记录一致),便于人工检查与修复。

export type SaveFormatErrorReason = 'invalid-json' | 'corrupted' | 'too-new';

// 类型化存档格式错误:应用层据此选择提示文案(损坏可删档、版本过高提示升级)。
export class SaveFormatError extends Error {
  public readonly reason: SaveFormatErrorReason;

  public constructor(reason: SaveFormatErrorReason, message: string) {
    super(message);
    this.name = 'SaveFormatError';
    this.reason = reason;
  }
}

// 迁移链:MIGRATIONS[v] 把 formatVersion v 的存档数据原地升级到 v+1(并把
// metadata.formatVersion 改成 v+1)。当前 v1 是最早且唯一版本,链为空;未来升级
// 格式时(例如给 player 增加字段)在这里追加一步迁移并把 WORLD_FORMAT_VERSION +1:
//   MIGRATIONS = [
//     (raw) => {
//       const player = raw.player as Record<string, unknown>
//       player.spawnPoint ??= { x: 0, y: 64, z: 0 }
//       ;(raw.metadata as Record<string, unknown>).formatVersion = 2
//     }
//   ]
const MIGRATIONS: readonly ((raw: Record<string, unknown>) => void)[] = [];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

// 校验物品栏:可选字段,旧存档缺失视为空物品栏(消费侧 Inventory.fromEntries 兜底)。
function validatePlayer(raw: unknown): StoredPlayerState {
  if (!isRecord(raw)) {
    throw new SaveFormatError('corrupted', '存档缺少玩家状态');
  }
  if (!isFiniteNumber(raw.x) || !isFiniteNumber(raw.y) || !isFiniteNumber(raw.z)) {
    throw new SaveFormatError('corrupted', '玩家坐标无效');
  }
  const inventory = raw.inventory;
  if (inventory === undefined) {
    return { x: raw.x, y: raw.y, z: raw.z };
  }
  const entriesValid =
    Array.isArray(inventory) &&
    inventory.every(
      (entry) => isRecord(entry) && isInteger(entry.blockId) && isInteger(entry.count)
    );
  if (!entriesValid) {
    throw new SaveFormatError('corrupted', '物品栏数据无效');
  }
  return {
    x: raw.x,
    y: raw.y,
    z: raw.z,
    inventory: inventory as unknown as StoredPlayerState['inventory']
  };
}

function validateMetadata(raw: unknown): WorldMetadata {
  if (!isRecord(raw)) {
    throw new SaveFormatError('corrupted', '存档缺少世界元数据');
  }
  if (!isInteger(raw.formatVersion)) {
    throw new SaveFormatError('corrupted', '元数据缺少格式版本号');
  }
  if (typeof raw.gameVersion !== 'string') {
    throw new SaveFormatError('corrupted', '元数据缺少游戏版本');
  }
  if (!isInteger(raw.generatorVersion)) {
    throw new SaveFormatError('corrupted', '元数据缺少生成器版本');
  }
  if (typeof raw.seed !== 'string' || raw.seed.length === 0) {
    throw new SaveFormatError('corrupted', '元数据缺少种子');
  }
  const modsValid =
    Array.isArray(raw.mods) &&
    raw.mods.every(
      (mod) =>
        isRecord(mod) &&
        typeof mod.id === 'string' &&
        typeof mod.version === 'string' &&
        typeof mod.hash === 'string'
    );
  if (!modsValid) {
    throw new SaveFormatError('corrupted', '元数据模组清单无效');
  }
  return {
    formatVersion: raw.formatVersion,
    gameVersion: raw.gameVersion,
    generatorVersion: raw.generatorVersion,
    seed: raw.seed,
    mods: raw.mods as unknown as WorldMetadata['mods']
  };
}

function validateChunks(raw: unknown): readonly StoredChunkDelta[] {
  if (!Array.isArray(raw)) {
    throw new SaveFormatError('corrupted', '存档缺少区块差异');
  }
  return raw.map((delta, index) => {
    if (!isRecord(delta) || !isInteger(delta.x) || !isInteger(delta.z)) {
      throw new SaveFormatError('corrupted', `第 ${index} 个区块差异无效`);
    }
    const changesValid =
      Array.isArray(delta.changes) &&
      delta.changes.every(
        (change) => isRecord(change) && isInteger(change.index) && isInteger(change.blockId)
      );
    if (!changesValid) {
      throw new SaveFormatError('corrupted', `第 ${index} 个区块差异的修改记录无效`);
    }
    return {
      x: delta.x,
      z: delta.z,
      changes: delta.changes as unknown as readonly StoredChunkDelta['changes'][number][]
    };
  });
}

function validateWorld(raw: Record<string, unknown>): StoredWorld {
  if (typeof raw.id !== 'string' || raw.id.length === 0) {
    throw new SaveFormatError('corrupted', '存档缺少标识');
  }
  if (!isFiniteNumber(raw.updatedAt)) {
    throw new SaveFormatError('corrupted', '存档缺少更新时间');
  }
  if (raw.name !== undefined && typeof raw.name !== 'string') {
    throw new SaveFormatError('corrupted', '存档名称无效');
  }
  const metadata = validateMetadata(raw.metadata);
  const player = validatePlayer(raw.player);
  const chunks = validateChunks(raw.chunks);
  return {
    id: raw.id,
    name: raw.name,
    metadata,
    player,
    chunks,
    updatedAt: raw.updatedAt
  };
}

// 校验并迁移任意来源(IndexedDB 记录/导入文件)的存档数据到当前格式版本。
// 顺序:粗校验取版本号 → 版本过高直接拒绝 → 逐级迁移 → 完整结构校验。
export function migrateWorldData(raw: unknown): StoredWorld {
  if (!isRecord(raw)) {
    throw new SaveFormatError('corrupted', '存档数据不是对象');
  }
  const metadata = raw.metadata;
  if (!isRecord(metadata) || !isInteger(metadata.formatVersion)) {
    throw new SaveFormatError('corrupted', '存档缺少格式版本号');
  }
  if (metadata.formatVersion > WORLD_FORMAT_VERSION) {
    throw new SaveFormatError('too-new', '存档来自更新版本的游戏,请升级游戏后再试');
  }
  let version = metadata.formatVersion;
  while (version < WORLD_FORMAT_VERSION) {
    const migration = MIGRATIONS[version];
    if (migration === undefined) {
      throw new SaveFormatError('corrupted', `缺少从格式版本 ${version} 开始的迁移`);
    }
    migration(raw);
    version += 1;
  }
  return validateWorld(raw);
}

// 把存档序列化为导出文件内容(带缩进的 JSON,顶层结构即 StoredWorld)。
export function serializeWorld(world: StoredWorld): string {
  return JSON.stringify(world, null, 2);
}

// 解析导入的存档文件:JSON 语法错误与结构错误分开归类,供界面给出不同提示。
export function parseWorldFile(json: string): StoredWorld {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new SaveFormatError('invalid-json', '存档文件不是有效的 JSON');
  }
  return migrateWorldData(parsed);
}

// 保存失败的粗略分类:配额耗尽单独提示,其余统一按普通失败处理。
export function classifySaveError(error: unknown): 'quota' | 'other' {
  if (error instanceof DOMException && error.name === 'QuotaExceededError') {
    return 'quota';
  }
  return 'other';
}
