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

export class VoxelWorldView implements BlockLookup {
  private readonly generator: TerrainGenerator;
  private readonly boundary: WorldBoundary;
  private readonly chunks = new Map<string, Chunk>();
  private readonly group = new THREE.Group();

  public constructor(options: VoxelWorldViewOptions) {
    this.generator = new TerrainGenerator(options.seed);
    this.boundary = options.boundary ?? new InfiniteWorldBoundary();

    for (let chunkX = -options.radius; chunkX <= options.radius; chunkX += 1) {
      for (let chunkZ = -options.radius; chunkZ <= options.radius; chunkZ += 1) {
        if (!this.boundary.containsChunk({ x: chunkX, z: chunkZ })) {
          continue;
        }
        const chunk = this.getChunk(chunkX, chunkZ);
        this.group.add(createChunkMesh(chunk, this), createWaterMesh(chunk, this));
      }
    }
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
}
