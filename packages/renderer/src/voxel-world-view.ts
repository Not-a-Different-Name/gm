import {
  BlockId,
  InfiniteWorldBoundary,
  TerrainGenerator,
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

export class VoxelWorldView implements BlockLookup {
  private readonly generator: TerrainGenerator;
  private readonly boundary: WorldBoundary;
  private readonly chunks = new Map<string, Chunk>();
  private readonly group = new THREE.Group();
  private readonly radius: number;
  private readonly renderedChunks = new Map<string, readonly THREE.Object3D[]>();

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

  public setBlock(x: number, y: number, z: number, blockId: BlockId): boolean {
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
      blockId
    );
    this.refreshRenderedChunk(chunkPosition.x, chunkPosition.z);
    if (localPosition.x === 0) this.refreshRenderedChunk(chunkPosition.x - 1, chunkPosition.z);
    if (localPosition.x === 15) this.refreshRenderedChunk(chunkPosition.x + 1, chunkPosition.z);
    if (localPosition.z === 0) this.refreshRenderedChunk(chunkPosition.x, chunkPosition.z - 1);
    if (localPosition.z === 15) this.refreshRenderedChunk(chunkPosition.x, chunkPosition.z + 1);
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

  public applyChunkDeltas(deltas: readonly ChunkDelta[]): void {
    for (const delta of deltas) {
      if (!this.boundary.containsChunk({ x: delta.x, z: delta.z })) {
        continue;
      }
      this.getChunk(delta.x, delta.z).applyChanges(delta.changes);
      this.refreshRenderedChunk(delta.x, delta.z);
    }
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

    for (const [key, objects] of this.renderedChunks) {
      if (!requiredChunks.has(key)) {
        this.removeRenderedChunk(key, objects);
      }
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
    const objects = [createChunkMesh(chunk, this), createWaterMesh(chunk, this)];
    const key = getChunkKey({ x, z });
    this.group.add(...objects);
    this.renderedChunks.set(key, objects);
  }

  private removeRenderedChunk(key: string, objects: readonly THREE.Object3D[]): void {
    for (const object of objects) {
      this.group.remove(object);
      if (object instanceof THREE.Mesh) {
        object.geometry.dispose();
        object.material.dispose();
      }
    }
    this.renderedChunks.delete(key);
  }

  private refreshRenderedChunk(x: number, z: number): void {
    const key = getChunkKey({ x, z });
    const objects = this.renderedChunks.get(key);
    if (objects !== undefined) {
      this.removeRenderedChunk(key, objects);
      this.addRenderedChunk(x, z);
    }
  }
}
