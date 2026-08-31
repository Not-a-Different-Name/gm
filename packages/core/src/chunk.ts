import { CHUNK_SIZE, WORLD_HEIGHT } from './chunk-coordinate.js';
import { BlockId } from './block.js';

const CHUNK_VOLUME = CHUNK_SIZE * WORLD_HEIGHT * CHUNK_SIZE;

export interface ChunkBlockChange {
  readonly index: number;
  readonly blockId: BlockId;
}

export class Chunk {
  private readonly blocks = new Uint8Array(CHUNK_VOLUME);
  private readonly changes = new Map<number, BlockId>();

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

  public setBlock(
    localX: number,
    y: number,
    localZ: number,
    blockId: BlockId,
    trackChange = true
  ): void {
    if (!this.isInside(localX, y, localZ)) {
      throw new RangeError(`区块内坐标无效：${localX}, ${y}, ${localZ}`);
    }

    const index = this.getIndex(localX, y, localZ);
    this.blocks[index] = blockId;
    if (trackChange) {
      this.changes.set(index, blockId);
    }
  }

  public countBlocks(blockId: BlockId): number {
    let count = 0;
    for (const currentBlockId of this.blocks) {
      if (currentBlockId === blockId) {
        count += 1;
      }
    }
    return count;
  }

  public getChanges(): readonly ChunkBlockChange[] {
    return [...this.changes].map(([index, blockId]) => ({ index, blockId }));
  }

  public applyChanges(changes: readonly ChunkBlockChange[]): void {
    for (const change of changes) {
      if (!Number.isInteger(change.index) || change.index < 0 || change.index >= CHUNK_VOLUME) {
        throw new RangeError(`区块方块索引无效：${change.index}`);
      }
      this.blocks[change.index] = change.blockId;
      this.changes.set(change.index, change.blockId);
    }
  }

  public clearChanges(): void {
    this.changes.clear();
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
