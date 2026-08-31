import type { ChunkPosition } from './chunk-coordinate.js';

export interface WorldBoundary {
  containsChunk(position: ChunkPosition): boolean;
}

export class InfiniteWorldBoundary implements WorldBoundary {
  public containsChunk(position: ChunkPosition): boolean {
    void position;
    return true;
  }
}

export class FixedWorldBoundary implements WorldBoundary {
  public constructor(
    private readonly minimumChunk: ChunkPosition,
    private readonly maximumChunk: ChunkPosition
  ) {
    if (
      minimumChunk.x > maximumChunk.x ||
      minimumChunk.z > maximumChunk.z ||
      !Number.isInteger(minimumChunk.x) ||
      !Number.isInteger(minimumChunk.z) ||
      !Number.isInteger(maximumChunk.x) ||
      !Number.isInteger(maximumChunk.z)
    ) {
      throw new RangeError('固定世界区块边界无效');
    }
  }

  public containsChunk(position: ChunkPosition): boolean {
    return (
      position.x >= this.minimumChunk.x &&
      position.x <= this.maximumChunk.x &&
      position.z >= this.minimumChunk.z &&
      position.z <= this.maximumChunk.z
    );
  }
}
