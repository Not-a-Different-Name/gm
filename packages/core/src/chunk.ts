import { CHUNK_SIZE, WORLD_HEIGHT } from './chunk-coordinate.js';
import { BlockId } from './block.js';

const CHUNK_VOLUME = CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE;

export class Chunk {
  private readonly blocks = new Uint8Array(CHUNK_VOLUME);

  public constructor(
    public readonly x: number,
    public readonly z: number
  ) {}

  public getBlock(localX: number, y: number, localZ: number): BlockId {
    if (!this.isInside(localX, y, localZ)) {
      return BlockId.Air;
    }

    return this.blocks[this.getIndex(localX, y, localZ)] as BlockId;
  }

  public setBlock(localX: number, y: number, localZ: number, blockId: BlockId): void {
    if (!this.isInside(localX, y, localZ)) {
      throw new RangeError(`区块内坐标无效：${localX}, ${y}, ${localZ}`);
    }

    this.blocks[this.getIndex(localX, y, localZ)] = blockId;
  }

  private getIndex(localX: number, y: number, localZ: number): number {
    return (y * CHUNK_SIZE + localZ) * CHUNK_SIZE + localX;
  }

  private isInside(localX: number, y: number, localZ: number): boolean {
    return (
      Number.isInteger(localX) &&
      Number.isInteger(y) &&
      Number.isInteger(localZ) &&
      localX >= 0 &&
      localX < CHUNK_SIZE &&
      localZ >= 0 &&
      localZ < CHUNK_SIZE &&
      y >= 0 &&
      y < WORLD_HEIGHT
    );
  }
}
