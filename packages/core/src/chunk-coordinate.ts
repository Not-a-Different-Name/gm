export const CHUNK_SIZE = 16;
export const WORLD_HEIGHT = 256;

export interface BlockPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface ChunkPosition {
  readonly x: number;
  readonly z: number;
}

export interface LocalBlockPosition {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export function toChunkCoordinate(worldCoordinate: number): number {
  return Math.floor(worldCoordinate / CHUNK_SIZE);
}

export function toLocalCoordinate(worldCoordinate: number): number {
  return ((worldCoordinate % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
}

export function getChunkPosition(position: BlockPosition): ChunkPosition {
  return {
    x: toChunkCoordinate(position.x),
    z: toChunkCoordinate(position.z)
  };
}

export function getLocalBlockPosition(position: BlockPosition): LocalBlockPosition {
  if (position.y < 0 || position.y >= WORLD_HEIGHT) {
    throw new RangeError(`方块高度必须在 0 到 ${WORLD_HEIGHT - 1} 之间：${position.y}`);
  }

  return {
    x: toLocalCoordinate(position.x),
    y: position.y,
    z: toLocalCoordinate(position.z)
  };
}

export function getChunkKey(position: ChunkPosition): string {
  return `${position.x},${position.z}`;
}
