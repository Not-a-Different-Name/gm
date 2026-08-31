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
  readonly textures: BlockTextureSet;
}

export interface BlockTextureSet {
  readonly top: string;
  readonly side: string;
  readonly bottom: string;
}

export const BLOCK_DEFINITIONS: Readonly<Record<BlockId, BlockDefinition>> = {
  [BlockId.Air]: {
    id: BlockId.Air,
    name: 'gm:air',
    solid: false,
    transparent: true,
    color: 0,
    textures: { top: 'air', side: 'air', bottom: 'air' }
  },
  [BlockId.Grass]: {
    id: BlockId.Grass,
    name: 'gm:grass',
    solid: true,
    transparent: false,
    color: 0x6f9c45,
    textures: { top: 'grass-top', side: 'grass-side', bottom: 'dirt' }
  },
  [BlockId.Dirt]: {
    id: BlockId.Dirt,
    name: 'gm:dirt',
    solid: true,
    transparent: false,
    color: 0x8a603c,
    textures: { top: 'dirt', side: 'dirt', bottom: 'dirt' }
  },
  [BlockId.Stone]: {
    id: BlockId.Stone,
    name: 'gm:stone',
    solid: true,
    transparent: false,
    color: 0x777b80,
    textures: { top: 'stone', side: 'stone', bottom: 'stone' }
  },
  [BlockId.Sand]: {
    id: BlockId.Sand,
    name: 'gm:sand',
    solid: true,
    transparent: false,
    color: 0xd8c37e,
    textures: { top: 'sand', side: 'sand', bottom: 'sand' }
  },
  [BlockId.Water]: {
    id: BlockId.Water,
    name: 'gm:water',
    solid: false,
    transparent: true,
    color: 0x3c84c6,
    textures: { top: 'water', side: 'water', bottom: 'water' }
  },
  [BlockId.Wood]: {
    id: BlockId.Wood,
    name: 'gm:wood',
    solid: true,
    transparent: false,
    color: 0x765133,
    textures: { top: 'wood-top', side: 'wood-side', bottom: 'wood-top' }
  },
  [BlockId.Leaves]: {
    id: BlockId.Leaves,
    name: 'gm:leaves',
    solid: false,
    transparent: true,
    color: 0x4e7f40,
    textures: { top: 'leaves', side: 'leaves', bottom: 'leaves' }
  },
  [BlockId.Bedrock]: {
    id: BlockId.Bedrock,
    name: 'gm:bedrock',
    solid: true,
    transparent: false,
    color: 0x35383a,
    textures: { top: 'bedrock', side: 'bedrock', bottom: 'bedrock' }
  }
};

export function isOpaqueBlock(blockId: BlockId): boolean {
  return !BLOCK_DEFINITIONS[blockId].transparent;
}

export function isSolidBlock(blockId: BlockId): boolean {
  return BLOCK_DEFINITIONS[blockId].solid;
}
