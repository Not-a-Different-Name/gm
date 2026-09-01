import { getTextureAtlas } from '@gm/renderer';

// 给菜单面板铺方块贴图蒙版:把图集单块放大成 64px 的 dataURL 平铺整个面板,
// 半透明暗色蒙层保证文字可读(蒙层样式见 .menu-panel.is-textured)。
export function applyTextureBackground(panel: HTMLElement, textureId: string): void {
  const tile = getTextureAtlas().copyTile(textureId, 0, 4);
  panel.classList.add('is-textured');
  panel.style.backgroundImage = `url("${tile.toDataURL()}")`;
  panel.style.backgroundSize = '64px 64px';
}
