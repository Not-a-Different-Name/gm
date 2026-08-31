import { describe, expect, it } from 'vitest';
import type { ModFingerprint } from '@gm/core';

import { hasMatchingMods } from './world-storage.js';

describe('存档模组校验', () => {
  it('要求模组 ID、版本和哈希一致', () => {
    const mods: ModFingerprint[] = [{ id: 'example:trees', version: '1.0.0', hash: 'abc' }];

    expect(hasMatchingMods(mods, mods)).toBe(true);
    expect(hasMatchingMods(mods, [{ id: 'example:trees', version: '1.0.0', hash: 'def' }])).toBe(
      false
    );
  });
});
