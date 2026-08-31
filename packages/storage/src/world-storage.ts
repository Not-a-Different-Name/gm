import type { ChunkBlockChange, ModFingerprint, WorldMetadata } from '@gm/core';

export interface StoredChunkDelta {
  readonly x: number;
  readonly z: number;
  readonly changes: readonly ChunkBlockChange[];
}

export interface StoredPlayerState {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface StoredWorld {
  readonly id: string;
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
    return this.runRequest<StoredWorld | undefined>(
      database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id)
    );
  }

  public async saveWorld(world: StoredWorld): Promise<void> {
    const database = await this.getDatabase();
    await this.runRequest(
      database.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(world)
    );
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
  metadata: WorldMetadata,
  player: StoredPlayerState,
  chunks: readonly StoredChunkDelta[]
): StoredWorld {
  return { id, metadata, player, chunks, updatedAt: Date.now() };
}

export function hasMatchingMods(
  savedMods: readonly ModFingerprint[],
  activeMods: readonly ModFingerprint[]
): boolean {
  return JSON.stringify(savedMods) === JSON.stringify(activeMods);
}
