import { getTextureAtlas } from '@gm/renderer';

// 给菜单界面层(全屏层或面板)铺方块贴图蒙版:把图集单块放大成 64px 的
// dataURL 平铺整个元素,半透明暗色蒙层保证文字可读(蒙层样式见 .is-textured)。
export function applyTextureBackground(layer: HTMLElement, textureId: string): void {
  const tile = getTextureAtlas().copyTile(textureId, 0, 4);
  layer.classList.add('is-textured');
  layer.style.backgroundImage = `url("${tile.toDataURL()}")`;
  layer.style.backgroundSize = '64px 64px';
}
