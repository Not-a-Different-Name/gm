import { describe, expect, it } from 'vitest';

import { FixedWorldBoundary, InfiniteWorldBoundary } from './world-boundary.js';

describe('世界边界', () => {
  it('无限世界接受任意区块', () => {
    const boundary = new InfiniteWorldBoundary();

    expect(boundary.containsChunk({ x: -999999, z: 999999 })).toBe(true);
  });

  it('固定世界排除边界以外的区块', () => {
    const boundary = new FixedWorldBoundary({ x: -1, z: -2 }, { x: 2, z: 3 });

    expect(boundary.containsChunk({ x: -1, z: -2 })).toBe(true);
    expect(boundary.containsChunk({ x: 2, z: 3 })).toBe(true);
    expect(boundary.containsChunk({ x: 3, z: 3 })).toBe(false);
  });
});
