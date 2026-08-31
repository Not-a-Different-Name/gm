export const WORLD_FORMAT_VERSION = 1;

export interface ModFingerprint {
  readonly id: string;
  readonly version: string;
  readonly hash: string;
}

export interface WorldMetadata {
  readonly formatVersion: number;
  readonly gameVersion: string;
  readonly generatorVersion: number;
  readonly seed: string;
  readonly mods: readonly ModFingerprint[];
}

export function createWorldMetadata(
  seed: string,
  gameVersion: string,
  mods: readonly ModFingerprint[] = []
): WorldMetadata {
  return {
    formatVersion: WORLD_FORMAT_VERSION,
    gameVersion,
    generatorVersion: 1,
    seed,
    mods: [...mods].sort((left, right) => left.id.localeCompare(right.id))
  };
}
