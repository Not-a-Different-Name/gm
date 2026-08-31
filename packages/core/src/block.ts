export const enum BlockId {
  Air = 0,
  Grass = 1,
  Dirt = 2,
  Stone = 3,
  Sand = 4,
  Water = 5,
  Wood = 6,
  Leaves = 7,
  Bedrock = 8
}

export interface BlockDefinition {
  readonly id: BlockId;
  readonly name: string;
  readonly solid: boolean;
  readonly transparent: boolean;
  readonly color: number;
}

export const BLOCK_DEFINITIONS: Readonly<Record<BlockId, BlockDefinition>> = {
  [BlockId.Air]: { id: BlockId.Air, name: 'gm:air', solid: false, transparent: true, color: 0 },
  [BlockId.Grass]: {
    id: BlockId.Grass,
    name: 'gm:grass',
    solid: true,
    transparent: false,
    color: 0x6f9c45
  },
  [BlockId.Dirt]: {
    id: BlockId.Dirt,
    name: 'gm:dirt',
    solid: true,
    transparent: false,
    color: 0x8a603c
  },
  [BlockId.Stone]: {
    id: BlockId.Stone,
    name: 'gm:stone',
    solid: true,
    transparent: false,
    color: 0x777b80
  },
  [BlockId.Sand]: {
    id: BlockId.Sand,
    name: 'gm:sand',
    solid: true,
    transparent: false,
    color: 0xd8c37e
  },
  [BlockId.Water]: {
    id: BlockId.Water,
    name: 'gm:water',
    solid: false,
    transparent: true,
    color: 0x3c84c6
  },
  [BlockId.Wood]: {
    id: BlockId.Wood,
    name: 'gm:wood',
    solid: true,
    transparent: false,
    color: 0x765133
  },
  [BlockId.Leaves]: {
    id: BlockId.Leaves,
    name: 'gm:leaves',
    solid: false,
    transparent: true,
    color: 0x4e7f40
  },
  [BlockId.Bedrock]: {
    id: BlockId.Bedrock,
    name: 'gm:bedrock',
    solid: true,
    transparent: false,
    color: 0x35383a
  }
};

export function isOpaqueBlock(blockId: BlockId): boolean {
  return !BLOCK_DEFINITIONS[blockId].transparent;
}
