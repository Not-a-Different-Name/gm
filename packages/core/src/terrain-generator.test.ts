import { describe, expect, it } from 'vitest';

import { BlockId } from './block.js';
import { SEA_LEVEL, TerrainGenerator } from './terrain-generator.js';

describe('TerrainGenerator', () => {
  it('相同种子生成相同地表', () => {
    const first = new TerrainGenerator('mountain-world');
    const second = new TerrainGenerator('mountain-world');

    expect(first.getSurfaceHeight(-350, 811)).toBe(second.getSurfaceHeight(-350, 811));
  });

  it('为低地填充海平面水体', () => {
    const generator = new TerrainGenerator('water-world');
    const chunk = generator.generateChunk(0, 0);
    const surface = generator.getSurfaceHeight(0, 0);

    expect(chunk.getBlock(0, 0, 0)).toBe(BlockId.Bedrock);
    if (surface < SEA_LEVEL) {
      expect(chunk.getBlock(0, SEA_LEVEL, 0)).toBe(BlockId.Water);
    }
  });

  it('生成稳定的树木方块', () => {
    const generator = new TerrainGenerator('forest-42');
    const first = generator.generateChunk(-1, 0);
    const second = generator.generateChunk(-1, 0);

    expect(first.countBlocks(BlockId.Wood)).toBeGreaterThan(0);
    expect(first.countBlocks(BlockId.Leaves)).toBeGreaterThan(0);
    expect(first.countBlocks(BlockId.Wood)).toBe(second.countBlocks(BlockId.Wood));
    expect(first.countBlocks(BlockId.Leaves)).toBe(second.countBlocks(BlockId.Leaves));
  });
});
