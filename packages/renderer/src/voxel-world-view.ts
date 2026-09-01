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
  /** 每帧流送预算（可选，默认 2/1/1）：生成数据 / 构建网格 / 执行待办重建的区块数。 */
  readonly dataChunksPerFrame?: number;
  readonly meshChunksPerFrame?: number;
  readonly rebuildChunksPerFrame?: number;
}

// 分帧流送默认预算：数据生成 2、网格构建 1、待办重建 1（重建保持原有节奏）。
const DEFAULT_DATA_CHUNKS_PER_FRAME = 2;
const DEFAULT_MESH_CHUNKS_PER_FRAME = 1;
const DEFAULT_REBUILD_CHUNKS_PER_FRAME = 1;
// 区块数据缓存上限：256 块 ≈ 16 MiB（每块 64 KiB），超出后按四条件淘汰。
const MAX_CACHED_CHUNKS = 256;
// 淘汰目标 = 上限 × 0.75（回滞防抖，避免在边界来回增删抖动）。
const CACHE_EVICTION_TARGET = Math.floor(MAX_CACHED_CHUNKS * 0.75);
// 每帧至多淘汰的区块数，避免单帧回收过多造成卡顿。
const EVICTIONS_PER_FRAME = 4;

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

// getChunkKey 产生的 "x,z" 键解析回区块坐标。
function splitChunkKey(key: string): [number, number] {
  return key.split(',').map(Number) as [number, number];
}

export class VoxelWorldView implements BlockLookup {
  private readonly generator: TerrainGenerator;
  private readonly boundary: WorldBoundary;
  private readonly chunks = new Map<string, Chunk>();
  private readonly group = new THREE.Group();
  private readonly radius: number;
  private readonly renderedChunks = new Map<string, RenderedChunk>();
  // 分帧流送队列：key → 与玩家中心区块的距离²，消费时最近优先（线性扫，队列 ≤49 项）。
  // pendingData 待生成数据，pendingMesh 数据已就绪待构建网格。
  private readonly pendingData = new Map<string, number>();
  private readonly pendingMesh = new Map<string, number>();
  // 跨区块边界写入时顺带需要重建的相邻区块：延后到 update 每帧按预算重建，
  // 避免一次操作同步重建多个区块造成卡顿。同样按距离²最近优先。
  private readonly pendingChunkRebuilds = new Map<string, number>();
  private readonly dataChunksPerFrame: number;
  private readonly meshChunksPerFrame: number;
  private readonly rebuildChunksPerFrame: number;
  // 最近一次 update 的玩家中心区块，供重建队列计算距离优先级。
  private playerChunkX = 0;
  private playerChunkZ = 0;
  // 运行时水位场：仅记录"调度器管理的流动/下落水"格 → 其 level（0..MAX）。
  // 键为世界坐标 "x,y,z"。不含永久水源（水源恒满，由方块本身表示），不进存档。
  private readonly waterLevels = new Map<string, number>();

  public constructor(options: VoxelWorldViewOptions) {
    this.generator = new TerrainGenerator(options.seed);
    this.boundary = options.boundary ?? new InfiniteWorldBoundary();
    this.radius = options.radius;
    this.dataChunksPerFrame = options.dataChunksPerFrame ?? DEFAULT_DATA_CHUNKS_PER_FRAME;
    this.meshChunksPerFrame = options.meshChunksPerFrame ?? DEFAULT_MESH_CHUNKS_PER_FRAME;
    this.rebuildChunksPerFrame = options.rebuildChunksPerFrame ?? DEFAULT_REBUILD_CHUNKS_PER_FRAME;

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

  // 存档保存成功后按快照清除已入库的修改记录（compare-and-delete）：
  // 保存期间同格被再次编辑的新修改会保留，不会随本次清除丢失。
  public clearChanges(deltas: readonly ChunkDelta[]): void {
    for (const delta of deltas) {
      if (!this.boundary.containsChunk({ x: delta.x, z: delta.z })) {
        continue;
      }
      this.getChunk(delta.x, delta.z).clearChanges(delta.changes);
    }
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
    this.playerChunkX = center.x;
    this.playerChunkZ = center.z;
    const requiredChunks = new Set<string>();

    // 登记需求区块：已渲染的保留，缺失的进入分帧流送队列（距玩家最近优先）。
    for (let chunkX = center.x - this.radius; chunkX <= center.x + this.radius; chunkX += 1) {
      for (let chunkZ = center.z - this.radius; chunkZ <= center.z + this.radius; chunkZ += 1) {
        const position = { x: chunkX, z: chunkZ };
        if (!this.boundary.containsChunk(position)) {
          continue;
        }

        const key = getChunkKey(position);
        requiredChunks.add(key);
        if (!this.renderedChunks.has(key) && !this.pendingMesh.has(key)) {
          const dx = chunkX - center.x;
          const dz = chunkZ - center.z;
          this.pendingData.set(key, dx * dx + dz * dz);
        }
      }
    }

    // 卸载同步执行（离开视距立即释放），不受每帧预算限制。
    for (const [key, rendered] of this.renderedChunks) {
      if (!requiredChunks.has(key)) {
        this.removeRenderedChunk(key, rendered);
      }
    }

    // 预算一：生成区块数据（最近优先），完成后移入网格队列。
    for (let count = 0; count < this.dataChunksPerFrame; count += 1) {
      const entry = this.takeNearestEntry(this.pendingData);
      if (entry === undefined) {
        break;
      }
      const [chunkX, chunkZ] = splitChunkKey(entry[0]);
      this.getChunk(chunkX, chunkZ);
      this.pendingMesh.set(entry[0], entry[1]);
    }

    // 预算二：构建网格（最近优先）。构建时的邻块查询可能顺带生成视距外的
    // 幽灵区块（面剔除正确性前提），仍不计入预算。
    for (let count = 0; count < this.meshChunksPerFrame; count += 1) {
      const entry = this.takeNearestEntry(this.pendingMesh);
      if (entry === undefined) {
        break;
      }
      const [chunkX, chunkZ] = splitChunkKey(entry[0]);
      this.addRenderedChunk(chunkX, chunkZ);
    }

    // 预算三：执行跨边界待办重建（最近优先），把一次操作的重建开销摊到多帧。
    for (let count = 0; count < this.rebuildChunksPerFrame; count += 1) {
      const entry = this.takeNearestEntry(this.pendingChunkRebuilds);
      if (entry === undefined) {
        break;
      }
      const [chunkX, chunkZ] = splitChunkKey(entry[0]);
      this.refreshRenderedChunk(chunkX, chunkZ);
    }

    this.evictCachedChunks(center.x, center.z);
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
    this.pendingMesh.delete(key);
    this.pendingData.delete(key);
  }

  // 把相邻区块的完整重建（实心 + 水面）放入待办队列，由 update 按预算执行。
  private queueChunkRebuild(chunkX: number, chunkZ: number): void {
    const key = getChunkKey({ x: chunkX, z: chunkZ });
    if (this.renderedChunks.has(key)) {
      const dx = chunkX - this.playerChunkX;
      const dz = chunkZ - this.playerChunkZ;
      this.pendingChunkRebuilds.set(key, dx * dx + dz * dz);
    }
  }

  // 取出队列中距玩家最近的条目（线性扫，队列 ≤49 项）。
  private takeNearestEntry(queue: Map<string, number>): [string, number] | undefined {
    let nearestKey: string | undefined;
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const [key, distance] of queue) {
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestKey = key;
      }
    }
    if (nearestKey === undefined) {
      return undefined;
    }
    queue.delete(nearestKey);
    return [nearestKey, nearestDistance];
  }

  // 缓存淘汰：超过 MAX_CACHED_CHUNKS 后，每帧回收至多 4 个区块数据，距玩家最远优先，
  // 直到 size ≤ 上限 × 0.75 为止。仅回收同时满足以下条件的区块：
  // ①未渲染（已渲染的网格持有其数据引用）；②无未保存修改；③世界范围内无运行时水位
  // 记录（否则流动水随淘汰凭空消失）；回收时防御性清掉三队列中的同名条目。
  private evictCachedChunks(centerX: number, centerZ: number): void {
    if (this.chunks.size <= MAX_CACHED_CHUNKS) {
      return;
    }

    const wetChunks = new Set<string>();
    for (const key of this.waterLevels.keys()) {
      const [x, , z] = key.split(',').map(Number) as [number, number, number];
      const chunkPosition = getChunkPosition({ x, y: 0, z });
      wetChunks.add(getChunkKey(chunkPosition));
    }

    const candidates: { key: string; distance: number }[] = [];
    for (const chunk of this.chunks.values()) {
      const key = getChunkKey({ x: chunk.x, z: chunk.z });
      if (this.renderedChunks.has(key) || wetChunks.has(key) || chunk.getChanges().length > 0) {
        continue;
      }
      const dx = chunk.x - centerX;
      const dz = chunk.z - centerZ;
      candidates.push({ key, distance: dx * dx + dz * dz });
    }
    candidates.sort((a, b) => b.distance - a.distance);

    const evictCount = Math.min(EVICTIONS_PER_FRAME, this.chunks.size - CACHE_EVICTION_TARGET);
    for (let index = 0; index < evictCount; index += 1) {
      const candidate = candidates[index];
      if (candidate === undefined) {
        break;
      }
      this.chunks.delete(candidate.key);
      this.pendingData.delete(candidate.key);
      this.pendingMesh.delete(candidate.key);
      this.pendingChunkRebuilds.delete(candidate.key);
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
