import * as THREE from 'three';

import { getTextureAtlas } from './texture-atlas.js';

// 贪心网格矩形在块内平铺图集纹理：uv 属性存"块内坐标"（矩形四角为 0..宽/高），
// aRegion 属性存该矩形对应图集 region 的原点与尺寸；片元着色器对 uv 取 fract 小数
// 部分映射回 region，实现逐块平铺（单行图集无法靠 RepeatWrapping 回到 region 起点）。
// 图集 minFilter 为 NearestFilter（无 mipmap），fract 在块边界的导数跳变不影响采样。
const MAP_FRAGMENT_TILED = /* glsl */ `
	#ifdef USE_MAP
		vec4 sampledDiffuseColor = texture2D( map, vRegion.xy + fract( vMapUv ) * vRegion.zw );
		diffuseColor *= sampledDiffuseColor;
	#endif
`;

let material: THREE.MeshLambertMaterial | undefined;

// 所有实心地形网格共享同一材质：避免每个区块各建一份，
// 区块卸载时也不再销毁材质（与水材质的共享模式一致）。
export function getSolidMaterial(): THREE.MeshLambertMaterial {
  if (material === undefined) {
    material = new THREE.MeshLambertMaterial({
      vertexColors: true,
      map: getTextureAtlas().texture,
      alphaTest: 0.5
    });
    material.onBeforeCompile = (shader) => {
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute vec4 aRegion;\nvarying vec4 vRegion;'
        )
        .replace('#include <uv_vertex>', '#include <uv_vertex>\nvRegion = aRegion;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec4 vRegion;')
        .replace('#include <map_fragment>', MAP_FRAGMENT_TILED);
    };
  }
  return material;
}
