import { describe, expect, it } from 'vitest';

import { SeededRandom } from './seeded-random.js';

describe('SeededRandom', () => {
  it('相同种子产生相同序列', () => {
    const first = new SeededRandom('world-001');
    const second = new SeededRandom('world-001');

    expect([first.next(), first.next(), first.next()]).toEqual([
      second.next(),
      second.next(),
      second.next()
    ]);
  });

  it('整数范围包含最小值且不包含最大值', () => {
    const random = new SeededRandom('range');

    for (let index = 0; index < 100; index += 1) {
      const value = random.nextInt(3, 7);
      expect(value).toBeGreaterThanOrEqual(3);
      expect(value).toBeLessThan(7);
    }
  });
});
