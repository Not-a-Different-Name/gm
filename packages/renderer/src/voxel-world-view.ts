import {
  BlockId,
  CHUNK_SIZE,
  InfiniteWorldBoundary,
  TerrainGenerator,
  WATER_NONE,
  getChunkKey,
  getChunkPosition,
  getLocalBlockPosition
} from '@gm/core';
import type { Chunk, WorldBoundary } from '@gm/core';
import * as THREE from 'three';

import { type BlockLookup, createChunkMesh, createWaterMesh } from './chunk-mesh.js';

export interface VoxelWorldViewOptions {
  readonly seed: string;
  readonly radius: number;
  readonly boundary?: WorldBoundary;
}

export interface ChunkDelta {
  readonly x: number;
  readonly z: number;
  readonly changes: ReturnType<Chunk['getChanges']>;
}

// 单个区块渲染出的两张网格：实心地形与半透明水面分开，便于只重建其一。
interface RenderedChunk {
  solid: THREE.Object3D;
  water: THREE.Object3D;
}

export class VoxelWorldView implements BlockLookup {
  private readonly generator: TerrainGenerator;
  private readonly boundary: WorldBoundary;
  private readonly chunks = new Map<string, Chunk>();
  private readonly group = new THREE.Group();
  private readonly radius: number;
  private readonly renderedChunks = new Map<string, RenderedChunk>();
  // 跨区块边界写入时顺带需要重建的相邻区块：延后到 update 每帧至多重建一个，
  // 避免一次操作同步重建多个区块造成卡顿。
  private readonly pendingChunkRebuilds = new Set<string>();
  // 运行时水位场：仅记录"调度器管理的流动/下落水"格 → 其 level（0..MAX）。
  // 键为世界坐标 "x,y,z"。不含永久水源（水源恒满，由方块本身表示），不进存档。
  private readonly waterLevels = new Map<string, number>();

  public constructor(options: VoxelWorldViewOptions) {
    this.generator = new TerrainGenerator(options.seed);
    this.boundary = options.boundary ?? new InfiniteWorldBoundary();
    this.radius = options.radius;

    this.update(0, 0);
  }

  public get object3d(): THREE.Object3D {
    return this.group;
  }

  public getBlock(x: number, y: number, z: number): BlockId {
    if (y < 0 || y >= 256) {
      return BlockId.Air;
    }

    const chunkPosition = getChunkPosition({ x, y, z });
    if (!this.boundary.containsChunk(chunkPosition)) {
      return BlockId.Air;
    }
    const localPosition = getLocalBlockPosition({ x, y, z });
    return this.getChunk(chunkPosition.x, chunkPosition.z).getBlock(
      localPosition.x,
      y,
      localPosition.z
    );
  }

  public getSpawnHeight(): number {
    return this.generator.getSurfaceHeight(0, 0) + 18;
  }

  // trackChange 默认 true，破坏/放置会记入存档差异。
  // 会即时重建本区块的完整网格（实心 + 水面）供玩家操作使用；
  // 跨区块边界的相邻区块延后到逐帧队列里重建，摊开一次操作的成本。
  public setBlock(x: number, y: number, z: number, blockId: BlockId, trackChange = true): boolean {
    if (!this.writeBlock(x, y, z, blockId, trackChange)) {
      return false;
    }
    const chunkPosition = getChunkPosition({ x, y, z });
    const localPosition = getLocalBlockPosition({ x, y, z });
    this.refreshRenderedChunk(chunkPosition.x, chunkPosition.z);
    if (localPosition.x === 0) this.queueChunkRebuild(chunkPosition.x - 1, chunkPosition.z);
    if (localPosition.x === 15) this.queueChunkRebuild(chunkPosition.x + 1, chunkPosition.z);
    if (localPosition.z === 0) this.queueChunkRebuild(chunkPosition.x, chunkPosition.z - 1);
    if (localPosition.z === 15) this.queueChunkRebuild(chunkPosition.x, chunkPosition.z + 1);
    return true;
  }

  // 该区块是否已渲染（有网格）。供射线遍历等工具限定在已加载区域内查询，
  // 避免 getBlock 顺带生成未加载区块。
  public hasRenderedChunk(chunkX: number, chunkZ: number): boolean {
    return this.renderedChunks.has(getChunkKey({ x: chunkX, z: chunkZ }));
  }

  // 运行时写入/移除一格水：不进存档、且不触发即时重建。
  // 水流调度器逐格调用此方法，最后由 refreshWater 批量重建受影响区块的水网格，
  // 避免"每流一格就整块重建"造成的卡顿。isWater=true 时记录其 level 供水面渲染分级下降。
  public setRuntimeWater(x: number, y: number, z: number, isWater: boolean, level: number): void {
    if (isWater) {
      this.writeBlock(x, y, z, BlockId.Water, false);
      this.waterLevels.set(`${x},${y},${z}`, level);
    } else {
      // writeBlock 会清除该格的水位记录。
      this.writeBlock(x, y, z, BlockId.Air, false);
    }
  }

  // 该格是否为调度器管理的流动水（已登记水位）。用于区分永久水源。
  public isRuntimeWater(x: number, y: number, z: number): boolean {
    return this.waterLevels.has(`${x},${y},${z}`);
  }

  // 该格水位：管理水返回其 level；是水方块但非管理水（即水源）返回 0；无水返回 WATER_NONE。
  public getWaterLevel(x: number, y: number, z: number): number {
    const level = this.waterLevels.get(`${x},${y},${z}`);
    if (level !== undefined) {
      return level;
    }
    return this.getBlock(x, y, z) === BlockId.Water ? 0 : WATER_NONE;
  }

  // 仅重建某区块的水面网格，不动实心地形网格（水流每 tick 的批量刷新入口）。
  public refreshWater(chunkX: number, chunkZ: number): void {
    const key = getChunkKey({ x: chunkX, z: chunkZ });
    const rendered = this.renderedChunks.get(key);
    if (rendered === undefined) {
      return;
    }
    this.disposeWater(rendered.water);
    const water = createWaterMesh(this.getChunk(chunkX, chunkZ), this);
    this.group.add(water);
    rendered.water = water;
  }

  // 写入方块并返回是否成功；不涉及任何网格重建。
  // 任何方块写入都会清除该格残留的运行时水位记录（改回水源/实体/空气后水位失效）；
  // 运行时流动水的水位由 setRuntimeWater 在写入后重新登记。
  private writeBlock(
    x: number,
    y: number,
    z: number,
    blockId: BlockId,
    trackChange: boolean
  ): boolean {
    if (y < 0 || y >= 256) {
      return false;
    }
    const chunkPosition = getChunkPosition({ x, y, z });
    if (!this.boundary.containsChunk(chunkPosition)) {
      return false;
    }
    const localPosition = getLocalBlockPosition({ x, y, z });
    this.getChunk(chunkPosition.x, chunkPosition.z).setBlock(
      localPosition.x,
      y,
      localPosition.z,
      blockId,
      trackChange
    );
    this.waterLevels.delete(`${x},${y},${z}`);
    return true;
  }

  public getModifiedChunks(): readonly ChunkDelta[] {
    const deltas: ChunkDelta[] = [];
    for (const chunk of this.chunks.values()) {
      const changes = chunk.getChanges();
      if (changes.length > 0) {
        deltas.push({ x: chunk.x, z: chunk.z, changes });
      }
    }
    return deltas;
  }

  // 应用存档差异到对应区块，并返回其中恢复出的水源世界坐标，
  // 供调用方唤醒水流调度器让水源重新蔓延（蔓延水不存档，读档后由水源重新爬出）。
  public applyChunkDeltas(deltas: readonly ChunkDelta[]): { x: number; y: number; z: number }[] {
    const restoredWaterSources: { x: number; y: number; z: number }[] = [];
    for (const delta of deltas) {
      if (!this.boundary.containsChunk({ x: delta.x, z: delta.z })) {
        continue;
      }
      this.getChunk(delta.x, delta.z).applyChanges(delta.changes);
      for (const change of delta.changes) {
        if (change.blockId !== BlockId.Water) {
          continue;
        }
        // 存档差异里的水方块即玩家放置的水源（蔓延水不进存档）。
        // index 按 Chunk.getIndex 排列：(y * 16 + localZ) * 16 + localX。
        restoredWaterSources.push({
          x: delta.x * CHUNK_SIZE + (change.index % CHUNK_SIZE),
          y: Math.floor(change.index / (CHUNK_SIZE * CHUNK_SIZE)),
          z: delta.z * CHUNK_SIZE + (Math.floor(change.index / CHUNK_SIZE) % CHUNK_SIZE)
        });
      }
      if (this.renderedChunks.has(getChunkKey({ x: delta.x, z: delta.z }))) {
        this.refreshRenderedChunk(delta.x, delta.z);
      }
    }
    return restoredWaterSources;
  }

  public update(worldX: number, worldZ: number): void {
    const center = getChunkPosition({ x: Math.floor(worldX), y: 0, z: Math.floor(worldZ) });
    const requiredChunks = new Set<string>();

    for (let chunkX = center.x - this.radius; chunkX <= center.x + this.radius; chunkX += 1) {
      for (let chunkZ = center.z - this.radius; chunkZ <= center.z + this.radius; chunkZ += 1) {
        const position = { x: chunkX, z: chunkZ };
        if (!this.boundary.containsChunk(position)) {
          continue;
        }

        const key = getChunkKey(position);
        requiredChunks.add(key);
        if (!this.renderedChunks.has(key)) {
          this.addRenderedChunk(chunkX, chunkZ);
        }
      }
    }

    for (const [key, rendered] of this.renderedChunks) {
      if (!requiredChunks.has(key)) {
        this.removeRenderedChunk(key, rendered);
      }
    }

    // 每帧至多重建一个待办区块，把跨边界重建的开销摊到多帧。
    const pendingKey = this.pendingChunkRebuilds.values().next().value;
    if (pendingKey !== undefined) {
      this.pendingChunkRebuilds.delete(pendingKey);
      const [pendingX, pendingZ] = pendingKey.split(',').map(Number) as [number, number];
      this.refreshRenderedChunk(pendingX, pendingZ);
    }
  }

  private getChunk(x: number, z: number): Chunk {
    const key = getChunkKey({ x, z });
    const existing = this.chunks.get(key);
    if (existing !== undefined) {
      return existing;
    }

    const generated = this.generator.generateChunk(x, z);
    this.chunks.set(key, generated);
    return generated;
  }

  private addRenderedChunk(x: number, z: number): void {
    const chunk = this.getChunk(x, z);
    const solid = createChunkMesh(chunk, this);
    const water = createWaterMesh(chunk, this);
    const key = getChunkKey({ x, z });
    this.group.add(solid, water);
    this.renderedChunks.set(key, { solid, water });
  }

  private removeRenderedChunk(key: string, rendered: RenderedChunk): void {
    this.disposeSolid(rendered.solid);
    this.disposeWater(rendered.water);
    this.renderedChunks.delete(key);
    this.pendingChunkRebuilds.delete(key);
  }

  // 把相邻区块的完整重建（实心 + 水面）放入待办队列，由 update 每帧至多执行一个。
  private queueChunkRebuild(chunkX: number, chunkZ: number): void {
    const key = getChunkKey({ x: chunkX, z: chunkZ });
    if (this.renderedChunks.has(key)) {
      this.pendingChunkRebuilds.add(key);
    }
  }

  // 释放实心地形网格：只销毁几何体，实心材质与水面材质一样在所有区块间共享。
  private disposeSolid(object: THREE.Object3D): void {
    this.group.remove(object);
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
    }
  }

  // 释放水面网格：只销毁几何体，水面材质在所有区块间共享，不能销毁。
  private disposeWater(object: THREE.Object3D): void {
    this.group.remove(object);
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
    }
  }

  private refreshRenderedChunk(x: number, z: number): void {
    const key = getChunkKey({ x, z });
    const rendered = this.renderedChunks.get(key);
    if (rendered === undefined) {
      return;
    }
    this.disposeSolid(rendered.solid);
    this.disposeWater(rendered.water);
    const chunk = this.getChunk(x, z);
    const solid = createChunkMesh(chunk, this);
    const water = createWaterMesh(chunk, this);
    this.group.add(solid, water);
    this.renderedChunks.set(key, { solid, water });
  }
}
