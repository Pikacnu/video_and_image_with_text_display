import { createCanvas, loadImage } from '@napi-rs/canvas';
import type { Pixel } from './image.ts';
import { deltaZ, fontSize } from './utils.ts';
/**
 * 代表一個連通區塊的資訊
 */
export interface Block {
  color: string; // hex format: #rrggbb
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
  area: number; // 實際像素數量
  pixels: [number, number][]; // [x, y][]
  zIndex: number; // 繪製順序，數字越大越上層
}

/**
 * 局部搜索優化選項
 */
interface LocalSearchOptions {
  maxIterations: number; // 最大迭代次數
  enableLogging: boolean; // 是否啟用日誌
}

/**
 * 檢查兩個區塊是否可以合併（相鄰且同色）
 */
function canMergeBlocks(block1: Block, block2: Block): boolean {
  // 必須同色
  if (block1.color !== block2.color) return false;

  // 檢查是否相鄰（四向連通）
  const pixelSet1 = new Set(block1.pixels.map(([x, y]) => `${x},${y}`));

  for (const [x, y] of block2.pixels) {
    // 檢查 block2 的每個像素是否與 block1 相鄰
    const neighbors = [
      `${x - 1},${y}`,
      `${x + 1},${y}`,
      `${x},${y - 1}`,
      `${x},${y + 1}`,
    ];
    if (neighbors.some((n) => pixelSet1.has(n))) {
      return true;
    }
  }

  return false;
}

/**
 * 合併兩個區塊
 */
function mergeBlocks(block1: Block, block2: Block): Block {
  const mergedPixels = [...block1.pixels, ...block2.pixels];

  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;

  for (const [x, y] of mergedPixels) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }

  return {
    color: block1.color,
    minX,
    minY,
    maxX,
    maxY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    area: mergedPixels.length,
    pixels: mergedPixels,
    zIndex: Math.min(block1.zIndex, block2.zIndex), // 保持較小的 z-index
  };
}

/**
 * 嘗試合併相鄰的同色區塊（貪心操作）
 */
function tryMergeOperation(blocks: Block[]): Block[] | null {
  // 按顏色分組以加速查找
  const colorGroups = new Map<string, Block[]>();

  for (const block of blocks) {
    if (!colorGroups.has(block.color)) {
      colorGroups.set(block.color, []);
    }
    colorGroups.get(block.color)!.push(block);
  }

  // 嘗試合併每個顏色組內的區塊
  for (const [color, group] of colorGroups.entries()) {
    if (group.length < 2) continue;

    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const block1 = group[i]!;
        const block2 = group[j]!;

        if (canMergeBlocks(block1, block2)) {
          // 找到可合併的區塊，執行合併
          const merged = mergeBlocks(block1, block2);

          // 創建新的區塊列表（移除 block1 和 block2，加入 merged）
          const newBlocks = blocks.filter((b) => b !== block1 && b !== block2);
          newBlocks.push(merged);

          return newBlocks;
        }
      }
    }
  }

  return null; // 沒有找到可合併的區塊
}

/**
 * 計算區塊列表的成本（越小越好）
 */
function calculateCost(blocks: Block[]): number {
  // 主要目標：最小化區塊數量
  let cost = blocks.length * 100;

  // 次要目標：獎勵面積大的區塊（鼓勵合併）
  for (const block of blocks) {
    cost -= block.area * 0.1; // 面積越大，成本越低
  }

  return cost;
}

/**
 * 局部搜索優化：貪心初始化 + 迭代改進
 */
function localSearchOptimization(
  initialBlocks: Block[],
  options: LocalSearchOptions,
): Block[] {
  const { maxIterations, enableLogging } = options;

  // ========== 階段 1: 貪心合併（快速初始化）==========
  let currentBlocks = [...initialBlocks];
  let greedyMerges = 0;

  if (enableLogging) {
    console.log(
      `\n🎯 Phase 1: Greedy Merge (initial: ${currentBlocks.length} blocks)`,
    );
  }

  // 貪心策略：不斷嘗試合併，直到無法再合併
  while (true) {
    const merged = tryMergeOperation(currentBlocks);
    if (merged === null) break; // 無法再合併

    currentBlocks = merged;
    greedyMerges++;

    if (enableLogging && greedyMerges % 10 === 0) {
      console.log(
        `  Merged ${greedyMerges} times → ${currentBlocks.length} blocks`,
      );
    }
  }

  if (enableLogging) {
    console.log(
      `✓ Phase 1 complete: ${greedyMerges} merges, ${currentBlocks.length} blocks remaining`,
    );
  }

  // ========== 階段 2: 局部搜索優化（邊緣微調）==========
  let currentCost = calculateCost(currentBlocks);
  let improvements = 0;
  let attempts = 0;

  if (enableLogging) {
    console.log(
      `\n🔍 Phase 2: Local Search (initial cost: ${currentCost.toFixed(2)})`,
    );
  }

  for (let iter = 0; iter < maxIterations; iter++) {
    attempts++;

    // 隨機選擇一個操作（交替策略）
    const operation = iter % 2;

    let neighborBlocks: Block[] | null = null;

    if (operation === 0) {
      // 操作 1: 嘗試再次合併（可能之前漏掉的）
      neighborBlocks = tryMergeOperation(currentBlocks);
    } else {
      // 操作 2: 嘗試分割大區塊（探索不同的分組方式）
      // 這裡暫時跳過，因為分割會增加區塊數，通常不是我們想要的
      neighborBlocks = null;
    }

    // 如果沒有鄰近解，跳過
    if (neighborBlocks === null) continue;

    // 計算新解的成本
    const neighborCost = calculateCost(neighborBlocks);

    // 接受準則：如果新解更好，則接受
    if (neighborCost < currentCost) {
      currentBlocks = neighborBlocks;
      currentCost = neighborCost;
      improvements++;

      if (enableLogging && improvements % 10 === 0) {
        console.log(
          `  Iteration ${iter}: Cost=${currentCost.toFixed(2)}, Blocks=${
            currentBlocks.length
          }, Improvements=${improvements}`,
        );
      }
    }
    // 否則拒絕（保持原狀）
  }

  if (enableLogging) {
    console.log(
      `✓ Phase 2 complete: ${improvements} improvements in ${attempts} attempts`,
    );
    console.log(
      `\n📊 Final result: ${initialBlocks.length} → ${
        currentBlocks.length
      } blocks (${(
        ((initialBlocks.length - currentBlocks.length) / initialBlocks.length) *
        100
      ).toFixed(1)}% reduction)`,
    );
  }

  // 重新分配 z-index
  currentBlocks.forEach((block, index) => {
    block.zIndex = index;
  });

  return currentBlocks;
}

/**
 * 處理影像並產生連通區塊分群
 * @param imagePath 影像檔路徑
 * @param options 選項
 * @returns 排序後的區塊陣列
 */
export async function processAndGroupImage(
  imagePath: string,
  options?: {
    resizeFactor?: number;
    outputDir?: string;
    sortBy?: 'area' | 'y_x';
  },
): Promise<Block[]> {
  const { resizeFactor = 1, outputDir, sortBy = 'area' } = options ?? {};

  // 1. 載入並縮放影像
  const image = await loadImage(await Bun.file(imagePath).arrayBuffer());
  const resizedWidth = Math.floor(image.width * resizeFactor);
  const resizedHeight = Math.floor(image.height * resizeFactor);

  const canvas = createCanvas(resizedWidth, resizedHeight);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, resizedWidth, resizedHeight);
  const colorData = ctx.getImageData(0, 0, resizedWidth, resizedHeight).data;

  // 2. 掃描像素並記錄顏色與座標
  const pixels: Pixel[] = [];
  const pixelMap = new Map<string, [number, number][]>(); // color -> [[x,y], ...]

  for (let y = 0; y < resizedHeight; y++) {
    for (let x = 0; x < resizedWidth; x++) {
      const i = (y * resizedWidth + x) * 4;
      const r = colorData[i]!;
      const g = colorData[i + 1]!;
      const b = colorData[i + 2]!;
      const a = colorData[i + 3]!;

      // 忽略完全透明的像素
      if (a === 0) continue;

      const pixel: Pixel = { r, g, b, a };
      pixels.push(pixel);

      const colorHex = ((r << 16) | (g << 8) | b)
        .toString(16)
        .padStart(6, '0')
        .toLowerCase();
      const colorKey = `#${colorHex}`;

      if (!pixelMap.has(colorKey)) {
        pixelMap.set(colorKey, []);
      }
      pixelMap.get(colorKey)!.push([x, y]);
    }
  }

  // 3. 對每個顏色做連通分群（四向連通）
  const blocks: Block[] = [];

  for (const [color, positions] of pixelMap.entries()) {
    // 建立座標集合以快速查找
    const posSet = new Set<string>();
    positions.forEach(([x, y]) => posSet.add(`${x},${y}`));

    const visited = new Set<string>();

    // BFS/DFS 尋找連通元件
    for (const [startX, startY] of positions) {
      const key = `${startX},${startY}`;
      if (visited.has(key)) continue;

      // 開始 BFS
      const queue: [number, number][] = [[startX, startY]];
      visited.add(key);
      const component: [number, number][] = [];

      while (queue.length > 0) {
        const [x, y] = queue.shift()!;
        component.push([x, y]);

        // 四向鄰居
        const neighbors: [number, number][] = [
          [x - 1, y],
          [x + 1, y],
          [x, y - 1],
          [x, y + 1],
        ];

        for (const [nx, ny] of neighbors) {
          const nKey = `${nx},${ny}`;
          if (!visited.has(nKey) && posSet.has(nKey)) {
            visited.add(nKey);
            queue.push([nx, ny]);
          }
        }
      }

      // 計算 bounding box
      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;
      for (const [x, y] of component) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }

      blocks.push({
        color,
        minX,
        minY,
        maxX,
        maxY,
        width: maxX - minX + 1,
        height: maxY - minY + 1,
        area: component.length,
        pixels: component,
        zIndex: 0, // Will be assigned after sorting
      });
    }
  }

  // 4. 排序區塊
  if (sortBy === 'area') {
    // 面積由大到小
    blocks.sort((a, b) => b.area - a.area);
  } else if (sortBy === 'y_x') {
    // 先 y（上到下）再 x（左到右）
    blocks.sort((a, b) => {
      if (a.minY !== b.minY) return a.minY - b.minY;
      return a.minX - b.minX;
    });
  }

  // 分配 z-index（排序後的順序，越後面越上層）
  blocks.forEach((block, index) => {
    block.zIndex = index;
  });

  // 4.5 應用局部搜索優化（貪心 + 邊緣微調）
  const optimizedBlocks = localSearchOptimization(blocks, {
    maxIterations: 1000, // 最多優化 1000 次
    enableLogging: blocks.length > 100, // 只在區塊多時顯示日誌（避免刷屏）
  });

  // 5. 可選：輸出 JSON
  if (outputDir) {
    const jsonPath = `${outputDir}/groups.json`;
    await Bun.write(jsonPath, JSON.stringify(optimizedBlocks, null, 2));
    console.log(
      `✓ Wrote ${optimizedBlocks.length} blocks to ${jsonPath} (optimized from ${blocks.length})`,
    );
  }

  return optimizedBlocks;
}

/**
 * 從區塊資料重建影像
 * @param blocks 區塊陣列（必須有 zIndex）
 * @param width 影像寬度
 * @param height 影像高度
 * @param outputPath 輸出檔案路徑
 * @param options 選項
 */
export async function rebuildImage(
  blocks: Block[],
  width: number,
  height: number,
  outputPath: string,
  options?: {
    backgroundColor?: string; // 背景色，預設透明
    scale?: number; // 放大倍率（預設 1）
  },
): Promise<void> {
  const { backgroundColor = 'transparent', scale = 1 } = options ?? {};

  const canvas = createCanvas(width * scale, height * scale);
  const ctx = canvas.getContext('2d');

  // 設定背景色
  if (backgroundColor !== 'transparent') {
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, width * scale, height * scale);
  }

  // 依 z-index 排序（小到大，先繪製底層）
  const sortedBlocks = [...blocks].sort((a, b) => a.zIndex - b.zIndex);

  // 繪製每個區塊
  for (const block of sortedBlocks) {
    ctx.fillStyle = block.color;

    // 繪製所有像素
    for (const [x, y] of block.pixels) {
      if (scale === 1) {
        ctx.fillRect(x, y, 1, 1);
      } else {
        // 放大時每個像素繪製成 scale x scale 的方塊
        ctx.fillRect(x * scale, y * scale, scale, scale);
      }
    }
  }

  // 輸出影像
  const buffer = canvas.toBuffer('image/png');
  await Bun.write(outputPath, buffer);
  console.log(`✓ Rebuilt image saved to ${outputPath}`);
}

/**
 * 生成 Minecraft function 來用 text_display 重建影像
 * @param blocks 區塊陣列
 * @param outputPath mcfunction 檔案輸出路徑
 * @param options 選項
 */
export async function generateMinecraftFunction(
  blocks: Block[],
  outputPath: string,
  options?: {
    pixelSize?: number; // 每個像素的 Minecraft 單位大小（預設 0.1）
    baseX?: number; // 基準 X 座標（預設 0）
    baseY?: number; // 基準 Y 座標（預設 0）
    baseZ?: number; // 基準 Z 座標（預設 0）
    tag?: string; // 實體標籤（預設 'generated_image'）
    useRectangles?: boolean; // 是否使用矩形優化（預設 true）
    rotationY?: number; // Y 軸旋轉角度（度數，預設 0）
    rotationX?: number; // X 軸旋轉角度（度數，預設 0）
    frameId?: number; // 幀 ID（用於 scoreboard 標記）
    clearPreviousFrames?: boolean; // 是否清除之前的幀（預設 false）
  },
): Promise<void> {
  const {
    pixelSize = 1,
    baseX = 0,
    baseY = 0,
    baseZ = 0,
    tag = 'generated_image',
    useRectangles = true,
    rotationY = 0,
    rotationX = 0,
    frameId,
    clearPreviousFrames = false,
  } = options ?? {};

  // 將角度轉換為四元數
  function degToRad(deg: number): number {
    return (deg * Math.PI) / 180;
  }

  function getQuaternionFromAxisAngle(
    axis: [number, number, number],
    angle: number,
  ): [number, number, number, number] {
    const halfAngle = angle / 2;
    const s = Math.sin(halfAngle);
    return [axis[0] * s, axis[1] * s, axis[2] * s, Math.cos(halfAngle)];
  }

  const commands: string[] = [];

  // 依 z-index 排序（小到大）
  const sortedBlocks = [...blocks].sort((a, b) => a.zIndex - b.zIndex);

  let entityCount = 0;
  let rectangleCount = 0;
  let pixelCount = 0;

  for (const block of sortedBlocks) {
    if (useRectangles) {
      // 使用 bounding box 矩形方式
      const width = block.width;
      const height = block.height;
      const centerX = (block.minX + block.maxX) / 2;
      const bottomY = block.minY + block.height;

      const mcX = baseX + centerX * pixelSize;
      const mcY = baseY - bottomY * pixelSize;
      const mcZ = baseZ + block.zIndex * deltaZ;
      // 數量計算
      rectangleCount++;

      // 計算旋轉以正確對齊文字方塊
      // left_rotation: 繞 X 軸旋轉 (俯仰角)
      // right_rotation: 繞 Y 軸旋轉 (偏航角)
      // 使用四元數 [x, y, z, w]

      // X 軸旋轉 (上下傾斜)
      const leftRot =
        rotationX !== 0
          ? getQuaternionFromAxisAngle([1, 0, 0], degToRad(rotationX))
          : [0, 0, 0, 1];

      // Y 軸旋轉 (左右轉動)
      const rightRot =
        rotationY !== 0
          ? getQuaternionFromAxisAngle([0, 1, 0], degToRad(rotationY))
          : [0, 0, 0, 1];

      // 生成 summon 命令
      const command = `summon text_display ${baseX} ${baseY} ${baseZ} {Tags:["${tag}","${tag}_${entityCount}","video_entity"],text:{"text":"█","color":"${
        block.color
      }"},background:0x00000000,transformation:{left_rotation:[${leftRot.join(
        'f,',
      )}f],right_rotation:[${rightRot.join(
        'f,',
      )}f],translation:[${mcX}f,${mcY}f,${mcZ}f],scale:[${
        width * pixelSize * fontSize
      }f,${
        height * pixelSize * fontSize
      }f,1f]},billboard:"fixed",view_range:50000f}`;

      commands.push(command);
      entityCount++;
    }
  }

  // 如果有 frameId，為所有實體設置 scoreboard
  if (frameId !== undefined) {
    commands.push('');
    commands.push(`# Set frame_id scoreboard for all entities`);
    commands.push(`scoreboard players set @e[tag=${tag}] frame_id ${frameId}`);
  }

  // 生成清除命令
  const headerComments: string[] = [];
  headerComments.push(
    `# Generated image from blocks (${entityCount} entities)`,
  );

  if (clearPreviousFrames && frameId !== undefined) {
    // 清除當前 I-Frame 之前的所有幀（包括所有舊的 I-Frame 和 P-Frame）
    headerComments.push(`# Clear all frames before frame ${frameId}`);
    const clearCommand = `execute as @e[tag=video_entity,scores={frame_id=..${
      frameId - 1
    }}] run kill @s`;
    commands.unshift(clearCommand);
    commands.unshift('');
  } else if (!clearPreviousFrames) {
    // 傳統方式：清除特定 tag 的實體
    headerComments.push(`# Clear existing entities with tag ${tag}`);
    const clearCommand = `kill @e[tag=${tag}]`;
    commands.unshift(clearCommand);
    commands.unshift('');
  }

  // 添加註釋
  headerComments.reverse().forEach((comment) => {
    commands.unshift(comment);
  });

  // 寫入檔案
  await Bun.write(outputPath, commands.join('\n'));
  console.log(
    `✓ Generated Minecraft function with ${entityCount} text_display entities`,
  );
  console.log(`  Output: ${outputPath}`);
  console.log(
    `  Generated: ${rectangleCount}, Skipped (low fill rate): ${pixelCount}`,
  );
}

// 直接執行時的範例
if (import.meta.main) {
  const imagePath = './test.jpg';
  const outputDir = './data/display/function/';

  console.log(`Processing ${imagePath}...`);
  const blocks = await processAndGroupImage(imagePath, {
    resizeFactor: 0.2, // 縮小到 10% 以減少實體數量
    outputDir,
    sortBy: 'area',
  });

  console.log(`\nFound ${blocks.length} connected blocks.`);
  console.log('Top 5 blocks by area (with z-index):');
  blocks.slice(0, 5).forEach((block, i) => {
    console.log(
      `  ${i + 1}. Color: ${block.color}, Area: ${block.area}, z-index: ${
        block.zIndex
      }, BBox: (${block.minX},${block.minY}) to (${block.maxX},${block.maxY})`,
    );
  });

  // 重建影像測試
  console.log('\nRebuilding image from blocks...');

  // 計算原始尺寸
  let maxX = 0,
    maxY = 0;
  for (const block of blocks) {
    if (block.maxX > maxX) maxX = block.maxX;
    if (block.maxY > maxY) maxY = block.maxY;
  }
  const width = maxX + 1;
  const height = maxY + 1;

  // 重建 1x 版本
  await rebuildImage(
    blocks,
    width,
    height,
    './data/display/function/rebuilt_1x.png',
  );

  console.log(`\nOriginal dimensions: ${width}x${height}`);
  console.log('Rebuild complete! Check rebuilt_1x.png and rebuilt_10x.png');

  // 生成 Minecraft function
  console.log('\nGenerating Minecraft function...');

  // 矩形模式（優化）- 包含所有區塊
  await generateMinecraftFunction(
    blocks,
    './data/display/function/spawn_image_rectangles.mcfunction',
    {
      pixelSize: 0.2,
      baseX: 0,
      baseY: 120,
      baseZ: 0,
      tag: 'generated_image',
      useRectangles: true,
    },
  );

  // // 矩形模式（極度優化）- 只保留較大區塊
  // const largeBlocks = blocks.filter((b) => b.area >= 10);
  // await generateMinecraftFunction(
  //   largeBlocks,
  //   './data/display/function/spawn_image_optimized.mcfunction',
  //   {
  //     pixelSize: 0.1,
  //     baseX: 0,
  //     baseY: 10,
  //     baseZ: 0,
  //     tag: 'generated_image_optimized',
  //     useRectangles: true,
  //   },
  // );

  // console.log(
  //   `\nFiltered ${
  //     blocks.length - largeBlocks.length
  //   } small blocks (area < 10 pixels)`,
  // );

  console.log('\n✓ All done! Use in Minecraft with:');
  console.log('  /function display:spawn_image_rectangles (all blocks)');
  console.log(
    '  /function display:spawn_image_optimized (large blocks only, recommended)',
  );
}
