import type { ChunkBlockChange, InventoryEntry, ModFingerprint, WorldMetadata } from '@gm/core';

import { migrateWorldData } from './world-format.js';

export interface StoredChunkDelta {
  readonly x: number;
  readonly z: number;
  readonly changes: readonly ChunkBlockChange[];
}

export interface StoredPlayerState {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  /** 物品栏持有数量；旧存档没有该字段（undefined 视为空物品栏），无需格式迁移。 */
  readonly inventory?: readonly InventoryEntry[];
}

export interface StoredWorld {
  readonly id: string;
  readonly name?: string;
  readonly metadata: WorldMetadata;
  readonly player: StoredPlayerState;
  readonly chunks: readonly StoredChunkDelta[];
  readonly updatedAt: number;
}

const DATABASE_NAME = 'gm-worlds';
const STORE_NAME = 'worlds';
const DATABASE_VERSION = 1;

export class WorldStorage {
  private databasePromise: Promise<IDBDatabase> | undefined;

  public async loadWorld(id: string): Promise<StoredWorld | undefined> {
    const database = await this.getDatabase();
    const world = await this.runRequest<unknown>(
      database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id)
    );
    // 读到的数据逐字段校验并迁移到当前格式版本:损坏/版本过高抛 SaveFormatError,
    // 不存在的存档保持 undefined 语义。
    return world === undefined ? undefined : migrateWorldData(world);
  }

  public async deleteWorld(id: string): Promise<void> {
    const database = await this.getDatabase();
    // 幂等:删除不存在的存档静默返回(调用方通常从列表触发)。
    await this.runRequest(
      database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(id)
    );
  }

  public async renameWorld(id: string, name: string): Promise<void> {
    const database = await this.getDatabase();
    const store = database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME);
    const world = await this.runRequest<unknown>(store.get(id));
    if (world === undefined) {
      return;
    }
    // 仅改名称,不刷新 updatedAt(避免列表顺序跳动);损坏数据在此同样报错。
    const valid = migrateWorldData(world);
    await this.runRequest(store.put({ ...valid, name }));
  }

  public async saveWorld(world: StoredWorld): Promise<void> {
    const database = await this.getDatabase();
    await this.runRequest(
      database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(world)
    );
  }

  public async listWorlds(seed: string): Promise<readonly StoredWorld[]> {
    const database = await this.getDatabase();
    const worlds = await this.runRequest<StoredWorld[]>(
      database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll()
    );
    return worlds
      .filter((world) => world.metadata.seed === seed)
      .sort((left, right) => right.updatedAt - left.updatedAt);
  }

  private getDatabase(): Promise<IDBDatabase> {
    this.databasePromise ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
      request.onerror = () => reject(request.error ?? new Error('无法打开本地世界存档'));
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains(STORE_NAME)) {
          request.result.createObjectStore(STORE_NAME, { keyPath: 'id' });
        }
      };
      request.onsuccess = () => resolve(request.result);
    });
    return this.databasePromise;
  }

  private runRequest<Result>(request: IDBRequest<Result>): Promise<Result> {
    return new Promise((resolve, reject) => {
      request.onerror = () => reject(request.error ?? new Error('本地世界存档操作失败'));
      request.onsuccess = () => resolve(request.result);
    });
  }
}

export function createStoredWorld(
  id: string,
  name: string,
  metadata: WorldMetadata,
  player: StoredPlayerState,
  inventory: readonly InventoryEntry[],
  chunks: readonly StoredChunkDelta[]
): StoredWorld {
  return {
    id,
    name,
    metadata,
    player: { ...player, inventory },
    chunks,
    updatedAt: Date.now()
  };
}

export function hasMatchingMods(
  savedMods: readonly ModFingerprint[],
  activeMods: readonly ModFingerprint[]
): boolean {
  return JSON.stringify(savedMods) === JSON.stringify(activeMods);
}
