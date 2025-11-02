import { createCanvas, loadImage } from '@napi-rs/canvas';
import { $, Glob } from 'bun';
import { mkdir, rmdir } from 'fs/promises';
import { existsSync } from 'fs';
import type { Pixel } from './image.ts';
import {
  processAndGroupImage,
  generateMinecraftFunction,
} from './image_group_processer.ts';
import type { Block } from './image_group_processer.ts';

/**
 * 影格類型
 */
export enum FrameType {
  I_FRAME = 'I', // 完整關鍵幀
  P_FRAME = 'P', // 預測幀（差異幀）
}

/**
 * 影格資訊
 */
export interface FrameInfo {
  frameNumber: number;
  frameType: FrameType;
  diffRatio: number; // 變化比例 (0-1)
  blocks: Block[]; // 需要更新的區塊
  removeEntities: string[]; // 需要刪除的實體標籤
  coveredEntities: string[]; // 被完全覆蓋的實體標籤（3D 掃描結果）
}

/**
 * 差異比較模式
 */
export enum DiffMode {
  IFRAME = 'iframe', // 與上一個 I-Frame 比較（減少堆疊）
  PREVIOUS = 'previous', // 與上一幀比較（傳統方式）
}

/**
 * 影片處理選項
 */
export interface VideoProcessOptions {
  frameRate?: number; // 影片幀率（預設 20）
  intervalBetweenFrames?: number; // 每幀間隔 tick（預設 1）
  resizeFactor?: number; // 縮放比例（預設 0.1）
  iFrameInterval?: number; // I-frame 間隔（預設 30）
  diffThreshold?: number; // 差異閾值，超過此比例強制 I-frame（預設 0.25）
  colorThreshold?: number; // 顏色差異閾值（預設 10）
  pixelSize?: number; // Minecraft 像素大小（預設 0.2）
  baseX?: number;
  baseY?: number;
  baseZ?: number;
  outputDir?: string;
  functionOutputDir?: string;
  isFillGaps?: boolean; // 是否填補間隙（預設 false）
  rotationX?: number; // X軸旋轉角度（預設 0）
  rotationY?: number; // Y軸旋轉角度（預設 0）
  videoModifyFactor?: number; // 影片長度倍率（預設 1.0）
  diffMode?: DiffMode; // 差異比較模式（預設 IFRAME）
}

/**
 * 使用 ffmpeg 將影片分割成影格
 */
export async function splitVideoIntoFrames(
  inputPath: string,
  outputDir: string,
  frameRate: number,
): Promise<void> {
  console.log(`Splitting video at ${frameRate} fps...`);
  await $`ffmpeg -i ${inputPath} -r ${frameRate} ${outputDir}/frame_%04d.png`.quiet();
  console.log('✓ Video split complete');
}

/**
 * 計算兩個像素的顏色差異
 */
function getColorDifference(p1: Pixel, p2: Pixel): number {
  const dr = Math.abs(p1.r - p2.r);
  const dg = Math.abs(p1.g - p2.g);
  const db = Math.abs(p1.b - p2.b);
  return Math.max(dr, dg, db); // 使用最大差異
}

/**
 * I-Frame 圖像資料快取
 */
interface ImageCache {
  imageData: Uint8ClampedArray;
  width: number;
  height: number;
}

const iframeImageCache = new Map<string, ImageCache>();

/**
 * 清除 I-Frame 快取（釋放記憶體）
 */
export function clearIFrameCache(): void {
  iframeImageCache.clear();
}

/**
 * 比較兩幀影像，生成差異圖（優化版本 + 快取）
 */
export async function generateDiffImage(
  prevImagePath: string,
  currentImagePath: string,
  options: {
    resizeFactor?: number;
    colorThreshold?: number;
    useCache?: boolean;
  },
): Promise<{
  width: number;
  height: number;
  diffPixels: Map<string, Pixel>; // 變化的像素 "x,y" -> Pixel
  diffRatio: number; // 變化比例
  currentImageData?: Uint8ClampedArray; // 返回當前圖像資料供快取使用
}> {
  const { resizeFactor = 0.1, colorThreshold = 10, useCache = false } = options;

  let prevData: Uint8ClampedArray;
  let width: number;
  let height: number;

  // 優化：檢查 I-Frame 快取
  const cachedPrevImage = useCache
    ? iframeImageCache.get(prevImagePath)
    : undefined;

  if (cachedPrevImage) {
    // 使用快取的圖像資料（大幅減少 I/O 和解碼時間）
    prevData = cachedPrevImage.imageData;
    width = cachedPrevImage.width;
    height = cachedPrevImage.height;
  } else {
    // 載入並處理前一幀
    const prevImageBuffer = await Bun.file(prevImagePath).arrayBuffer();
    const prevImage = await loadImage(prevImageBuffer);
    width = Math.floor(prevImage.width * resizeFactor);
    height = Math.floor(prevImage.height * resizeFactor);

    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(prevImage, 0, 0, width, height);
    prevData = ctx.getImageData(0, 0, width, height).data;

    // 如果啟用快取且是 I-Frame，儲存資料
    if (useCache) {
      iframeImageCache.set(prevImagePath, {
        imageData: new Uint8ClampedArray(prevData),
        width,
        height,
      });
    }
  }

  // 載入並處理當前幀
  const currentImageBuffer = await Bun.file(currentImagePath).arrayBuffer();
  const currentImage = await loadImage(currentImageBuffer);

  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(currentImage, 0, 0, width, height);
  const currentData = ctx.getImageData(0, 0, width, height).data;

  // 優化：逐像素比較，減少物件創建
  const diffPixels = new Map<string, Pixel>();
  let changedPixelCount = 0;
  const totalPixels = width * height;

  for (let i = 0; i < totalPixels; i++) {
    const idx = i * 4;
    const pr = prevData[idx]!;
    const pg = prevData[idx + 1]!;
    const pb = prevData[idx + 2]!;

    const cr = currentData[idx]!;
    const cg = currentData[idx + 1]!;
    const cb = currentData[idx + 2]!;

    // 內聯顏色差異計算
    const dr = Math.abs(pr - cr);
    const dg = Math.abs(pg - cg);
    const db = Math.abs(pb - cb);
    const maxDiff = Math.max(dr, dg, db);

    if (maxDiff > colorThreshold) {
      const y = Math.floor(i / width);
      const x = i % width;
      diffPixels.set(`${x},${y}`, {
        r: cr,
        g: cg,
        b: cb,
        a: currentData[idx + 3]!,
      });
      changedPixelCount++;
    }
  }

  const diffRatio = changedPixelCount / totalPixels;

  return {
    width,
    height,
    diffPixels,
    diffRatio,
    currentImageData: useCache ? new Uint8ClampedArray(currentData) : undefined,
  };
}

/**
 * 將差異像素轉換為臨時影像檔案用於分塊處理（優化版本）
 */
async function createDiffImageFile(
  width: number,
  height: number,
  diffPixels: Map<string, Pixel>,
  outputPath: string,
): Promise<void> {
  const canvas = createCanvas(width, height);
  const ctx = canvas.getContext('2d');

  // 優化：直接操作 ImageData，避免多次 fillRect 調用
  const imageData = ctx.createImageData(width, height);
  const data = imageData.data;

  // 所有像素初始化為透明
  for (let i = 0; i < data.length; i += 4) {
    data[i + 3] = 0; // alpha = 0
  }

  // 只設定變化的像素
  for (const [coord, pixel] of diffPixels.entries()) {
    const [x, y] = coord.split(',').map(Number);
    if (x !== undefined && y !== undefined) {
      const idx = (y * width + x) * 4;
      data[idx] = pixel.r;
      data[idx + 1] = pixel.g;
      data[idx + 2] = pixel.b;
      data[idx + 3] = pixel.a;
    }
  }

  ctx.putImageData(imageData, 0, 0);
  const buffer = canvas.toBuffer('image/png');
  await Bun.write(outputPath, buffer);
}

/**
 * 檢查一個區塊是否被另一個區塊完全覆蓋（3D 掃描）
 */
function isBlockFullyCovered(
  targetBlock: Block,
  coveringBlock: Block,
): boolean {
  // 如果 covering block 的 z-index 不在 target 前面，無法覆蓋
  if (coveringBlock.zIndex <= targetBlock.zIndex) {
    return false;
  }

  // 檢查所有 target 的像素是否都被 covering block 覆蓋
  const coveringPixelSet = new Set<string>();
  for (const [x, y] of coveringBlock.pixels) {
    coveringPixelSet.add(`${x},${y}`);
  }

  for (const [x, y] of targetBlock.pixels) {
    if (!coveringPixelSet.has(`${x},${y}`)) {
      return false; // 有像素未被覆蓋
    }
  }

  return true; // 所有像素都被覆蓋
}

/**
 * 3D 掃描：找出所有被完全覆蓋的區塊（優化版本）
 * @param allFrameInfos 目前所有影格資訊
 * @param currentIFrameIndex 當前 I-Frame 的索引（用於範圍限制）
 * @returns 被完全覆蓋的實體標籤陣列
 */
function scan3DCoveredBlocks(
  allFrameInfos: FrameInfo[],
  currentIFrameIndex: number,
): string[] {
  // 只掃描當前 I-Frame 群組內的影格
  const currentGroupFrames = allFrameInfos.slice(currentIFrameIndex);
  if (currentGroupFrames.length < 2) {
    return []; // 少於 2 幀無需掃描
  }

  // 優化：只檢查最近 N 幀，避免過長的掃描
  const MAX_SCAN_FRAMES = 10;
  const framesToScan =
    currentGroupFrames.length > MAX_SCAN_FRAMES
      ? currentGroupFrames.slice(-MAX_SCAN_FRAMES)
      : currentGroupFrames;

  // 收集所有區塊及其標籤（使用 Set 去重）
  const coveredTagSet = new Set<string>();
  const allBlocks: Array<{ block: Block; tag: string; zIndex: number }> = [];

  for (const frameInfo of framesToScan) {
    const tag =
      frameInfo.frameType === FrameType.I_FRAME
        ? `video_frame_${frameInfo.frameNumber}`
        : `video_frame_${frameInfo.frameNumber}_diff`;

    for (const block of frameInfo.blocks) {
      allBlocks.push({ block, tag, zIndex: block.zIndex });
    }
  }

  // 優化：按 z-index 排序，從後往前掃描（只需檢查前面的層）
  allBlocks.sort((a, b) => b.zIndex - a.zIndex);

  // 建立空間索引：按區域劃分區塊（簡化版本）
  const spatialGrid = new Map<string, typeof allBlocks>();
  const GRID_SIZE = 10; // 網格大小

  for (const item of allBlocks) {
    const gridX = Math.floor(item.block.minX / GRID_SIZE);
    const gridY = Math.floor(item.block.minY / GRID_SIZE);
    const key = `${gridX},${gridY}`;

    if (!spatialGrid.has(key)) {
      spatialGrid.set(key, []);
    }
    spatialGrid.get(key)!.push(item);
  }

  // 對每個區塊檢查是否被覆蓋（使用空間索引優化）
  for (let i = allBlocks.length - 1; i >= 0; i--) {
    const targetItem = allBlocks[i]!;

    // 計算目標區塊所在的網格範圍
    const minGridX = Math.floor(targetItem.block.minX / GRID_SIZE);
    const maxGridX = Math.floor(targetItem.block.maxX / GRID_SIZE);
    const minGridY = Math.floor(targetItem.block.minY / GRID_SIZE);
    const maxGridY = Math.floor(targetItem.block.maxY / GRID_SIZE);

    // 只檢查相鄰網格中的區塊
    let isFullyCovered = false;
    for (let gx = minGridX; gx <= maxGridX && !isFullyCovered; gx++) {
      for (let gy = minGridY; gy <= maxGridY && !isFullyCovered; gy++) {
        const candidates = spatialGrid.get(`${gx},${gy}`) || [];

        for (const coveringItem of candidates) {
          // 跳過自己和後面的區塊
          if (coveringItem.zIndex <= targetItem.zIndex) continue;

          if (isBlockFullyCovered(targetItem.block, coveringItem.block)) {
            coveredTagSet.add(targetItem.tag);
            isFullyCovered = true;
            break;
          }
        }
      }
    }
  }

  return Array.from(coveredTagSet);
}

/**
 * 處理影片幀序列（從現有影格檔案）
 */
/**
 * 批次處理多個 P-Frames（並行優化）
 */
async function processPFramesBatch(
  frameIndices: number[],
  framePaths: string[],
  compareFramePath: string,
  options: {
    resizeFactor: number;
    colorThreshold: number;
    diffMode: DiffMode;
  },
): Promise<
  Array<{
    frameIndex: number;
    width: number;
    height: number;
    diffPixels: Map<string, Pixel>;
    diffRatio: number;
  }>
> {
  // 並行處理多個 P-Frames 的差異計算
  const results = await Promise.all(
    frameIndices.map(async (frameIndex) => {
      const currentFramePath = framePaths[frameIndex]!;
      const diffResult = await generateDiffImage(
        compareFramePath,
        currentFramePath,
        {
          resizeFactor: options.resizeFactor,
          colorThreshold: options.colorThreshold,
          useCache: options.diffMode === DiffMode.IFRAME,
        },
      );
      return {
        frameIndex,
        ...diffResult,
      };
    }),
  );
  return results;
}

export async function processVideoFrames(
  framePaths: string[],
  options: VideoProcessOptions,
): Promise<FrameInfo[]> {
  const {
    resizeFactor = 0.1,
    iFrameInterval = 30,
    diffThreshold = 0.25,
    colorThreshold = 10,
    pixelSize = 0.2,
    baseX = 0,
    baseY = 120,
    baseZ = 0,
    outputDir = './data/display/function/frames/',
    rotationX = 0,
    rotationY = 0,
    diffMode = DiffMode.IFRAME, // 預設與 I-Frame 比較
  } = options;

  const frameInfos: FrameInfo[] = [];
  let lastIFramePath: string | null = null; // 追蹤上一個 I-Frame
  let prevFramePath: string | null = null; // 追蹤上一幀（用於 PREVIOUS 模式）
  let currentIFrameIndex = -1; // 當前 I-Frame 群組的起始索引

  // 追蹤最大 z-index，確保每個新影格都在前面
  let maxZIndexUsed = 0;

  // 用於批量 mcfunction 生成的 Promise 數組
  const mcfunctionPromises: Promise<void>[] = [];

  for (let i = 0; i < framePaths.length; i++) {
    const currentFramePath = framePaths[i]!;
    const frameNumber = i;

    // 優化：每 10 幀顯示一次進度
    if (i % 10 === 0 || i === framePaths.length - 1) {
      const progress = ((i / framePaths.length) * 100).toFixed(1);
      console.log(
        `Processing frame ${frameNumber}/${framePaths.length} (${progress}%)...`,
      );
    }

    // 判斷是否為 I-frame
    const isIFrame =
      i === 0 || // 第一幀
      i % iFrameInterval === 0 || // 定期 I-frame
      lastIFramePath === null;

    if (isIFrame) {
      // I-Frame: 完整處理
      console.log(`  → I-Frame (keyframe)`);

      // 更新 I-Frame 索引
      currentIFrameIndex = frameInfos.length;
      lastIFramePath = currentFramePath;

      const blocks = await processAndGroupImage(currentFramePath, {
        resizeFactor,
        sortBy: 'area',
      });

      // 調整所有 blocks 的 z-index，確保在之前所有影格的前面
      blocks.forEach((block) => {
        block.zIndex += maxZIndexUsed;
      });

      // 更新最大 z-index
      const maxZInThisFrame = Math.max(...blocks.map((b) => b.zIndex));
      maxZIndexUsed = maxZInThisFrame + 1;

      // 生成 mcfunction，使用 frameId 和自動清除（非阻塞）
      const mcfunctionPath = `${outputDir}frame_${frameNumber}.mcfunction`;
      const mcfunctionPromise = generateMinecraftFunction(
        blocks,
        mcfunctionPath,
        {
          pixelSize,
          baseX,
          baseY,
          baseZ,
          tag: `video_frame_${frameNumber}`,
          useRectangles: true,
          rotationX,
          rotationY,
          frameId: frameNumber, // 設置幀 ID
          clearPreviousFrames: i > 0, // 第一幀不需要清除，之後的幀都清除之前的
        },
      );
      mcfunctionPromises.push(mcfunctionPromise);

      frameInfos.push({
        frameNumber,
        frameType: FrameType.I_FRAME,
        diffRatio: 1.0,
        blocks,
        removeEntities: [], // 使用 scoreboard 清除，不需要記錄標籤
        coveredEntities: [], // I-Frame 剛建立，無覆蓋檢查
      });
    } else {
      // P-Frame: 差異處理
      // 根據 diffMode 選擇比較對象
      const compareFramePath =
        diffMode === DiffMode.IFRAME ? lastIFramePath! : prevFramePath!;
      const diffModeLabel =
        diffMode === DiffMode.IFRAME
          ? `I-Frame ${currentIFrameIndex}`
          : 'previous frame';

      const { width, height, diffPixels, diffRatio, currentImageData } =
        await generateDiffImage(compareFramePath, currentFramePath, {
          resizeFactor,
          colorThreshold,
          useCache: diffMode === DiffMode.IFRAME, // 在 IFRAME 模式下啟用快取
        });

      console.log(
        `  → P-Frame (diff from ${diffModeLabel}: ${(diffRatio * 100).toFixed(
          2,
        )}%)`,
      );

      // 如果差異太大，強制改為 I-frame
      if (diffRatio >= diffThreshold) {
        console.log(
          `  → Converted to I-Frame (diff > ${diffThreshold * 100}%)`,
        );

        const blocks = await processAndGroupImage(currentFramePath, {
          resizeFactor,
          sortBy: 'area',
        });

        // 調整所有 blocks 的 z-index，確保在之前所有影格的前面
        blocks.forEach((block) => {
          block.zIndex += maxZIndexUsed;
        });

        // 更新最大 z-index
        const maxZInThisFrame = Math.max(...blocks.map((b) => b.zIndex));
        maxZIndexUsed = maxZInThisFrame + 1;

        // 更新為新的 I-Frame
        currentIFrameIndex = frameInfos.length;
        lastIFramePath = currentFramePath;

        const mcfunctionPath = `${outputDir}frame_${frameNumber}.mcfunction`;
        const mcfunctionPromise = generateMinecraftFunction(
          blocks,
          mcfunctionPath,
          {
            pixelSize,
            baseX,
            baseY,
            baseZ,
            tag: `video_frame_${frameNumber}`,
            useRectangles: true,
            rotationX,
            rotationY,
            frameId: frameNumber, // 設置幀 ID
            clearPreviousFrames: true, // 強制轉換的 I-Frame 也要清除之前的幀
          },
        );
        mcfunctionPromises.push(mcfunctionPromise);

        frameInfos.push({
          frameNumber,
          frameType: FrameType.I_FRAME,
          diffRatio,
          blocks,
          removeEntities: [], // 使用 scoreboard 清除
          coveredEntities: [],
        });
      } else {
        // 正常 P-frame 處理
        const diffImagePath = `${outputDir}temp_diff_${frameNumber}.png`;
        await createDiffImageFile(width, height, diffPixels, diffImagePath);

        const blocks = await processAndGroupImage(diffImagePath, {
          resizeFactor: 1, // 已經縮放過了
          sortBy: 'area',
        });

        // 調整所有 blocks 的 z-index，確保 P-Frame 在之前所有影格的前面
        blocks.forEach((block) => {
          block.zIndex += maxZIndexUsed;
        });

        // 更新最大 z-index
        if (blocks.length > 0) {
          const maxZInThisFrame = Math.max(...blocks.map((b) => b.zIndex));
          maxZIndexUsed = maxZInThisFrame + 1;
        }

        const mcfunctionPath = `${outputDir}frame_${frameNumber}.mcfunction`;
        const mcfunctionPromise = generateMinecraftFunction(
          blocks,
          mcfunctionPath,
          {
            pixelSize,
            baseX,
            baseY,
            baseZ,
            tag: `video_frame_${frameNumber}_diff`,
            useRectangles: true,
            rotationX,
            rotationY,
            frameId: frameNumber, // 設置幀 ID
            clearPreviousFrames: false, // P-Frame 不清除之前的幀（疊加顯示）
          },
        ).then(async () => {
          // 執行 3D 掃描，找出被完全覆蓋的實體
          const coveredEntities = scan3DCoveredBlocks(
            frameInfos,
            currentIFrameIndex,
          );

          // 如果有被覆蓋的實體，使用 scoreboard 刪除（更精確）
          if (coveredEntities.length > 0) {
            console.log(
              `    🗑️  Removing ${coveredEntities.length} covered entities`,
            );
            const mcfunctionContent = await Bun.file(mcfunctionPath).text();
            // 使用 tag 匹配刪除被覆蓋的實體
            const uniqueTags = Array.from(new Set(coveredEntities));
            const tagList = uniqueTags.map((tag) => `tag=${tag}`).join(',');
            const killCommand = `kill @e[type=text_display,${tagList}]`;
            await Bun.write(
              mcfunctionPath,
              `# Remove covered entities (3D scan)\n${killCommand}\n\n${mcfunctionContent}`,
            );
          }
        });
        mcfunctionPromises.push(mcfunctionPromise);

        frameInfos.push({
          frameNumber,
          frameType: FrameType.P_FRAME,
          diffRatio,
          blocks,
          removeEntities: [], // P-frame 不刪除舊實體，而是疊加
          coveredEntities: [], // 3D 掃描結果（稍後在 Promise 中計算）
        });

        // 刪除臨時 diff 圖片
        // await Bun.write(diffImagePath, ''); // 可選：清理臨時文件
      }
    }

    // 更新 prevFramePath 用於 PREVIOUS 模式
    prevFramePath = currentFramePath;
  }

  // 等待所有 mcfunction 文件生成完成
  console.log(
    `\n⏳ Waiting for ${mcfunctionPromises.length} mcfunction files to finish writing...`,
  );
  await Promise.all(mcfunctionPromises);
  console.log(`✅ All mcfunction files generated successfully`);

  // 輸出快取統計資訊
  if (diffMode === DiffMode.IFRAME) {
    const cacheSize = iframeImageCache.size;
    const totalIFrames = frameInfos.filter(
      (f) => f.frameType === FrameType.I_FRAME,
    ).length;
    console.log(`\n📊 I-Frame Cache Statistics:`);
    console.log(`  Cached I-Frames: ${cacheSize}`);
    console.log(`  Total I-Frames: ${totalIFrames}`);
    console.log(
      `  Cache Hit Potential: ${(
        (cacheSize / Math.max(totalIFrames, 1)) *
        100
      ).toFixed(1)}%`,
    );
  }

  return frameInfos;
}

/**
 * 完整的影片處理流程（從影片檔案開始）
 */
export async function generateVideoFromFile(
  inputVideoPath: string,
  outputDir: string,
  functionOutputDir: string,
  options: VideoProcessOptions,
): Promise<void> {
  const {
    frameRate = 20,
    intervalBetweenFrames = 1,
    resizeFactor = 0.1,
    iFrameInterval = 30,
    diffThreshold = 0.25,
    colorThreshold = 10,
    pixelSize = 0.2,
    baseX = 0,
    baseY = 120,
    baseZ = 0,
    isFillGaps = false,
    rotationX = 0,
    rotationY = 0,
    videoModifyFactor = 1.0,
  } = options;

  const diffMode = options.diffMode ?? DiffMode.IFRAME;

  // 效能計時器
  const perfTimers = {
    total: Date.now(),
    videoSplit: 0,
    frameProcessing: 0,
    functionGeneration: 0,
  };

  console.log(`
🎬 Video Processing Configuration:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Frame Rate: ${frameRate} fps
  Interval Between Frames: ${intervalBetweenFrames} tick
  Frame Resize Factor: ${resizeFactor}
  Video Length Factor: ${videoModifyFactor}
  I-Frame Interval: ${iFrameInterval} frames
  Diff Threshold: ${diffThreshold * 100}%
  Color Threshold: ${colorThreshold}
  Diff Mode: ${
    diffMode === DiffMode.IFRAME ? '📦 I-Frame' : '⏮️  Previous Frame'
  }
  Pixel Size: ${pixelSize}
  Fill Gaps: ${isFillGaps}
  Rotation: X=${rotationX}°, Y=${rotationY}°
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  `);

  // 清理舊檔案
  if (existsSync(`${functionOutputDir}`)) {
    await rmdir(`${functionOutputDir}`, { recursive: true });
  }
  if (existsSync(`${outputDir}/frames`)) {
    await rmdir(`${outputDir}/frames`, { recursive: true });
  }

  // 建立目錄
  await mkdir(`${outputDir}/frames`, { recursive: true });
  await mkdir(`${functionOutputDir}/frames`, { recursive: true });

  // 分割影片
  const splitStart = Date.now();
  await splitVideoIntoFrames(inputVideoPath, `${outputDir}/frames`, frameRate);
  perfTimers.videoSplit = Date.now() - splitStart;

  // 獲取所有幀檔案
  const scanner = new Glob('frame_*.png');
  const files = Array.from(scanner.scanSync(`${outputDir}/frames`)).sort();
  const totalFrames = Math.floor(files.length * videoModifyFactor);
  const framePaths = files
    .slice(0, totalFrames)
    .map((file) => `${outputDir}/frames/${file}`);

  console.log(`📊 Processing ${totalFrames} frames...`);

  // 處理影格
  const processStart = Date.now();
  const frameInfos = await processVideoFrames(framePaths, {
    resizeFactor,
    iFrameInterval,
    diffThreshold,
    colorThreshold,
    pixelSize,
    baseX,
    baseY,
    baseZ,
    outputDir: `${functionOutputDir}/frames/`,
    rotationX,
    rotationY,
    diffMode,
  });
  perfTimers.frameProcessing = Date.now() - processStart;

  // 生成控制函數
  const funcStart = Date.now();
  await generateVideoControlFunctions(
    frameInfos,
    functionOutputDir,
    intervalBetweenFrames,
    isFillGaps,
  );
  perfTimers.functionGeneration = Date.now() - funcStart;

  // 清理臨時幀檔案
  console.log('🧹 Cleaning up temporary files...');
  await rmdir(`${outputDir}/frames`, { recursive: true });

  // 生成統計資訊
  const totalCoveredEntities = frameInfos.reduce(
    (sum, f) => sum + f.coveredEntities.length,
    0,
  );
  const totalBlocks = frameInfos.reduce((sum, f) => sum + f.blocks.length, 0);

  const stats = {
    totalFrames: frameInfos.length,
    iFrames: frameInfos.filter((f) => f.frameType === FrameType.I_FRAME).length,
    pFrames: frameInfos.filter((f) => f.frameType === FrameType.P_FRAME).length,
    averageDiffRatio:
      frameInfos.reduce((sum, f) => sum + f.diffRatio, 0) / frameInfos.length,
    totalBlocks,
    totalCoveredEntities,
    optimizationRate:
      totalBlocks > 0
        ? ((totalCoveredEntities / totalBlocks) * 100).toFixed(2)
        : '0.00',
  };

  await Bun.write(
    `${functionOutputDir}/video_stats.json`,
    JSON.stringify(stats, null, 2),
  );

  console.log('\n📈 Video Statistics:');
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(`  Total frames: ${stats.totalFrames}`);
  console.log(`  I-Frames (keyframes): ${stats.iFrames}`);
  console.log(`  P-Frames (diff): ${stats.pFrames}`);
  console.log(
    `  Average diff ratio: ${(stats.averageDiffRatio * 100).toFixed(2)}%`,
  );
  console.log(`  Total blocks generated: ${stats.totalBlocks}`);
  console.log(
    `  🗑️  Covered entities removed: ${stats.totalCoveredEntities} (${stats.optimizationRate}%)`,
  );
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  // 計算總時間
  perfTimers.total = Date.now() - perfTimers.total;

  // 顯示效能統計
  console.log('⚡ Performance Statistics:');
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
  console.log(
    `  Video Splitting: ${(perfTimers.videoSplit / 1000).toFixed(2)}s`,
  );
  console.log(
    `  Frame Processing: ${(perfTimers.frameProcessing / 1000).toFixed(2)}s (${(
      perfTimers.frameProcessing / stats.totalFrames
    ).toFixed(0)}ms/frame)`,
  );
  console.log(
    `  Function Generation: ${(perfTimers.functionGeneration / 1000).toFixed(
      2,
    )}s`,
  );
  console.log(`  Total Time: ${(perfTimers.total / 1000).toFixed(2)}s`);
  console.log(
    `  Average FPS: ${(stats.totalFrames / (perfTimers.total / 1000)).toFixed(
      2,
    )} frames/sec`,
  );
  console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);

  // 清除快取釋放記憶體
  clearIFrameCache();
  console.log('✓ I-Frame cache cleared\n');

  console.log('✅ All done!\n');
}

/**
 * 生成影片播放控制函數
 */
async function generateVideoControlFunctions(
  frameInfos: FrameInfo[],
  functionOutputDir: string,
  intervalBetweenFrames: number,
  isFillGaps: boolean,
): Promise<void> {
  const lastFrameIndex = frameInfos.length - 1;

  // 1. setup_video.mcfunction - 初始化
  await Bun.write(
    `${functionOutputDir}/setup_video.mcfunction`,
    `# Video Setup
scoreboard objectives add video_system dummy
scoreboard objectives add frame_id dummy "Frame ID"
scoreboard players set current_frame video_system 0
scoreboard players set last_frame video_system ${lastFrameIndex}
scoreboard players set video_playing video_system 0
data merge storage video:data {data:{frameIndex:0}}
tellraw @a {"text":"✓ Video system initialized (with frame_id tracking)","color":"green"}
`,
  );

  // 2. reset_video.mcfunction - 重置
  await Bun.write(
    `${functionOutputDir}/reset_video.mcfunction`,
    `# Reset Video
scoreboard players set current_frame video_system 0
scoreboard players set video_playing video_system 0
data merge storage video:data {data:{frameIndex:0}}
kill @e[tag=video_entity]
tellraw @a {"text":"✓ Video reset (all frames cleared)","color":"yellow"}
`,
  );

  // 3. run_video.mcfunction - 主循環
  await Bun.write(
    `${functionOutputDir}/run_video.mcfunction`,
    `# Run Video Loop
execute if score current_frame video_system >= last_frame video_system run scoreboard players set video_playing video_system 0
execute if score video_playing video_system matches 0 run return run function video:reset_video

scoreboard players add current_frame video_system 1
execute store result storage video:data data.frameIndex int 1 run scoreboard players get current_frame video_system

function video:run_video_frame with storage video:data data
${
  isFillGaps
    ? `execute positioned ~ ~-0.05 ~ run function video:run_video_frame with storage video:data data
execute positioned ~0.025 ~ ~ run function video:run_video_frame with storage video:data data
execute positioned ~0.025 ~-0.05 ~ run function video:run_video_frame with storage video:data data`
    : ''
}

schedule function video:run_video ${intervalBetweenFrames}t
`,
  );

  // 4. run_video_frame.mcfunction - 執行單幀
  await Bun.write(
    `${functionOutputDir}/run_video_frame.mcfunction`,
    `# Run Single Frame
$function video:frames/frame_\$(frameIndex)
`,
  );

  // 5. play_video.mcfunction - 播放
  await Bun.write(
    `${functionOutputDir}/play_video.mcfunction`,
    `# Play Video
scoreboard players set video_playing video_system 1
function video:run_video
tellraw @a {"text":"▶ Playing video","color":"green"}
`,
  );

  // 6. pause_video.mcfunction - 暫停
  await Bun.write(
    `${functionOutputDir}/pause_video.mcfunction`,
    `# Pause Video
scoreboard players set video_playing video_system 0
tellraw @a {"text":"⏸ Video paused","color":"yellow"}
`,
  );

  // 7. run_frame.mcfunction - 執行指定幀
  await Bun.write(
    `${functionOutputDir}/run_frame.mcfunction`,
    `# Run Specific Frame
$function video:frames/frame_\$(frameIndex)
${
  isFillGaps
    ? `$execute positioned ~ ~-0.05 ~ run function video:frames/frame_\$(frameIndex)
$execute positioned ~0.025 ~ ~ run function video:frames/frame_\$(frameIndex)
$execute positioned ~0.025 ~-0.05 ~ run function video:frames/frame_\$(frameIndex)`
    : ''
}
`,
  );
}

// 測試用範例
if (import.meta.main) {
  const inputVideoPath = './source.mp4';
  const outputDir = './data/video';
  const functionOutputDir = `${outputDir}/function`;

  await generateVideoFromFile(inputVideoPath, outputDir, functionOutputDir, {
    frameRate: 10,
    intervalBetweenFrames: 1,
    resizeFactor: 0.1,
    iFrameInterval: 10,
    diffThreshold: 0.2,
    colorThreshold: 20,
    pixelSize: 0.1,
    baseX: 0,
    baseY: 50,
    baseZ: 0,
    isFillGaps: false,
    rotationX: 0,
    rotationY: 0,
    videoModifyFactor: 0.5,
    diffMode: DiffMode.IFRAME,
  });
}
