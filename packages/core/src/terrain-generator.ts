import { BlockId } from './block.js';
import { Chunk } from './chunk.js';
import { CHUNK_SIZE } from './chunk-coordinate.js';

export const SEA_LEVEL = 62;

function smoothstep(value: number): number {
  return value * value * (3 - 2 * value);
}

function hash2(seed: number, x: number, z: number): number {
  let value = Math.imul(x, 374761393) + Math.imul(z, 668265263) + seed * 1442695041;
  value = Math.imul(value ^ (value >>> 13), 1274126177);
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
}

function valueNoise(seed: number, x: number, z: number, scale: number): number {
  const scaledX = x / scale;
  const scaledZ = z / scale;
  const baseX = Math.floor(scaledX);
  const baseZ = Math.floor(scaledZ);
  const localX = smoothstep(scaledX - baseX);
  const localZ = smoothstep(scaledZ - baseZ);
  const bottom = hash2(seed, baseX, baseZ) * (1 - localX) + hash2(seed, baseX + 1, baseZ) * localX;
  const top =
    hash2(seed, baseX, baseZ + 1) * (1 - localX) + hash2(seed, baseX + 1, baseZ + 1) * localX;
  return bottom * (1 - localZ) + top * localZ;
}

function hashSeed(seed: string): number {
  let value = 0;
  for (const character of seed) {
    value = Math.imul(value ^ (character.codePointAt(0) ?? 0), 16777619);
  }
  return value >>> 0;
}

export class TerrainGenerator {
  private readonly seed: number;

  public constructor(seed: string) {
    this.seed = hashSeed(seed);
  }

  public getSurfaceHeight(worldX: number, worldZ: number): number {
    const continents = valueNoise(this.seed, worldX, worldZ, 220) - 0.5;
    const hills = valueNoise(this.seed + 1, worldX, worldZ, 72) - 0.5;
    const detail = valueNoise(this.seed + 2, worldX, worldZ, 28) - 0.5;
    const height = SEA_LEVEL + continents * 42 + hills * 18 + detail * 5;
    return Math.max(24, Math.min(142, Math.floor(height)));
  }

  public generateChunk(chunkX: number, chunkZ: number): Chunk {
    const chunk = new Chunk(chunkX, chunkZ);
    const worldStartX = chunkX * CHUNK_SIZE;
    const worldStartZ = chunkZ * CHUNK_SIZE;

    for (let localX = 0; localX < CHUNK_SIZE; localX += 1) {
      for (let localZ = 0; localZ < CHUNK_SIZE; localZ += 1) {
        const worldX = worldStartX + localX;
        const worldZ = worldStartZ + localZ;
        const surfaceY = this.getSurfaceHeight(worldX, worldZ);
        const isBeach = surfaceY <= SEA_LEVEL + 1;

        chunk.setBlock(localX, 0, localZ, BlockId.Bedrock);
        for (let y = 1; y <= surfaceY; y += 1) {
          const block =
            y === surfaceY
              ? isBeach
                ? BlockId.Sand
                : BlockId.Grass
              : y >= surfaceY - 3
                ? isBeach
                  ? BlockId.Sand
                  : BlockId.Dirt
                : BlockId.Stone;
          chunk.setBlock(localX, y, localZ, block);
        }

        for (let y = surfaceY + 1; y <= SEA_LEVEL; y += 1) {
          chunk.setBlock(localX, y, localZ, BlockId.Water);
        }
      }
    }

    return chunk;
  }
}
