import { createCanvas, loadImage } from '@napi-rs/canvas';
import {
  bigChunkTemplate,
  chunkEntryTemplate,
  commandTemplate,
  dataMergeCommandTemplate,
  blockLeading,
  withPaddingLineHeight,
  widthNeededPerBlock,
  lineHeight,
  chunkTemplate,
  bgColorUpdateCommandTemplate,
} from './utils.ts';

export type Pixel = { r: number; g: number; b: number; a: number };

export enum ColorSize {
  _16 = 16,
  _256 = 256,
}

function getColorString(
  r: number,
  g: number,
  b: number,
  colorSize: ColorSize,
): string {
  if (colorSize === ColorSize._16) {
    const r16 = Math.round((r / 255) * 15);
    const g16 = Math.round((g / 255) * 15);
    const b16 = Math.round((b / 255) * 15);
    return `#${((r16 << 8) | (g16 << 4) | b16).toString(16).padStart(3, '0')}`;
  }
  if (colorSize === ColorSize._256) {
    return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
  }
  throw new Error('Unsupported color size');
}

const mergedPixels = (
  pixels: Pixel[],
  maxChunkLength = 2 ** 15 - 1,
): Array<Pixel[]> =>
  pixels.reduce((acc: Array<Pixel[]>, pixel) => {
    if (acc.length === 0) {
      acc.push([pixel]);
      return acc;
    }
    const lastGroup = acc[acc.length - 1]!;
    const lastPixel = lastGroup[0]!;
    if (lastGroup.length >= maxChunkLength) {
      acc.push([pixel]);
      return acc;
    }
    if (
      lastPixel.r === pixel.r &&
      lastPixel.g === pixel.g &&
      lastPixel.b === pixel.b
    ) {
      lastGroup.push(pixel);
    } else {
      acc.push([pixel]);
    }
    return acc;
  }, [] as Array<Pixel[]>);

export type ImageProcessOptions = {
  resizeFactor?: number;
  groupLineCount?: number;
  isGenerateWithLineCombinations?: boolean;
  blockGroupThreshold?: number;
  colorSize?: ColorSize;
  outputResizeFactor?: number;
  isUsingDataMergeCommand?: boolean;
  isBackgroundTransparent?: boolean;
  isUsingResourcePackFont?: boolean;
};

export async function processImageWithLineCombinations(
  imagePath: string,
  outputDir: string,
  options: ImageProcessOptions,
  prefix = '',
): Promise<void | [string, [number, number], number, string][]> {
  const {
    resizeFactor = 1,
    groupLineCount = 50,
    isGenerateWithLineCombinations = false,
    blockGroupThreshold = 100,
    colorSize = ColorSize._256,
    outputResizeFactor = 1,
    isUsingDataMergeCommand = false,
    isBackgroundTransparent = true,
    isUsingResourcePackFont = false,
  } = options;

  if (isGenerateWithLineCombinations && isUsingDataMergeCommand) {
    throw new Error(
      'isGenerateWithLineCombinations and isUsingDataMergeCommand NOT supported together.',
    );
  }

  const image = await loadImage(await Bun.file(imagePath).arrayBuffer());
  const resizedWidth = Math.floor(image.width * resizeFactor);
  const resizedHeight = Math.floor(image.height * resizeFactor);

  const canvas = createCanvas(resizedWidth, resizedHeight);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, resizedWidth, resizedHeight);
  const colorData = ctx.getImageData(0, 0, resizedWidth, resizedHeight).data;

  let pixels: Pixel[] = [];

  for (let i = 0; i < colorData.length; i += 4) {
    const r = colorData[i];
    const g = colorData[i + 1];
    const b = colorData[i + 2];
    const a = colorData[i + 3];
    pixels.push({ r, g, b, a } as Pixel);
  }

  let PixelsByLine: Array<Pixel>[] = Array.from(
    { length: resizedHeight },
    () => [],
  );

  for (let y = 0; y < resizedHeight; y++) {
    for (let x = 0; x < resizedWidth; x++) {
      const pixel = pixels[y * resizedWidth + x]!;
      if (pixel) {
        PixelsByLine[y]!.push(pixel);
      }
    }
  }

  let lines: string[] = [];

  const pixelsGroupedByMultipleLines: Array<Pixel>[] = Array.from(
    { length: Math.ceil(PixelsByLine.length / groupLineCount) },
    () => [],
  );

  for (let i = 0; i < PixelsByLine.length; i += groupLineCount) {
    const groupedPixels: Pixel[][] = [];
    for (let j = 0; j < groupLineCount && i + j < PixelsByLine.length; j++) {
      groupedPixels.push(PixelsByLine[i + j]!);
    }
    pixelsGroupedByMultipleLines[Math.floor(i / groupLineCount)] =
      groupedPixels.flat();
  }

  const lastChunkBottomPaddingLines =
    PixelsByLine.length % groupLineCount === 0
      ? 0
      : groupLineCount - (PixelsByLine.length % groupLineCount);

  let entityData = [] as [string, [number, number], string][];

  for (let i = 0; i < pixelsGroupedByMultipleLines.length; i++) {
    let textContent = '';

    const linePixels = pixelsGroupedByMultipleLines[i]!;

    const pixelsMergedByColor = mergedPixels(linePixels, blockGroupThreshold);
    const currentChunkColorMap = new Map<string, number>();
    // CombinedWithColorChunksByCheckCountOfColorInTheRange
    const [, combinedChunks] = pixelsMergedByColor.reduce(
      (source, currentChunk, index) => {
        const colorTableMap = source[0]!;
        const cacheArray = source[2]!;
        currentChunk.forEach((pixel) => {
          const colorHex = ((pixel.r << 16) | (pixel.g << 8) | pixel.b)
            .toString(16)
            .padStart(6, '0');
          source[0]!.set(
            `#${colorHex.toLowerCase()}`,
            (source[0]!.get(`#${colorHex.toLowerCase()}`) ?? 0) + 1,
          );
          currentChunkColorMap.set(
            colorHex,
            (currentChunkColorMap.get(colorHex) ?? 0) + 1,
          );
        });
        let target = '';
        for (const [color, count] of colorTableMap.entries()) {
          if (count >= blockGroupThreshold) {
            target = color;
            break;
          }
        }
        if (target !== '') {
          cacheArray.push(currentChunk);
          const flattenedCache = cacheArray.flat();
          if (flattenedCache.length > 0) {
            source[1]!.push([target, flattenedCache]);
          }
          source[0] = new Map();
          source[2] = [];
        } else {
          source[2].push(currentChunk);
        }
        if (index === pixelsMergedByColor.length - 1 && source[2]!.length > 0) {
          let maxColor = '';
          let maxCount = 0;
          source[0]!.forEach((count, color) => {
            if (count > maxCount) {
              maxCount = count;
              maxColor = color;
            }
          });
          const flattenedCache = source[2]!.flat();
          if (flattenedCache.length > 0 && maxColor) {
            source[1]!.push([maxColor, flattenedCache]);
          }
        }
        return source;
      },
      [new Map(), [], []] as [
        Map<string, number>,
        Array<[string, Pixel[]]>,
        Array<Pixel[]>,
      ],
    );

    for (let j = 0; j < combinedChunks.length; j++) {
      const [color, pixelChunk] = combinedChunks[j]!;
      textContent += bigChunkTemplate
        .replace('@color@', color)
        .replace('@inner@', () => {
          let innerText = '';
          const mergedInnerPixels = mergedPixels(pixelChunk);
          for (let k = 0; k < mergedInnerPixels.length; k++) {
            const currentInnerChunk = mergedInnerPixels[k]!;
            const firstPixel = currentInnerChunk[0]!;
            const colorHex = (
              (firstPixel.r << 16) |
              (firstPixel.g << 8) |
              firstPixel.b
            )
              .toString(16)
              .padStart(6, '0');
            innerText += chunkEntryTemplate
              .replace(
                '@color@',
                color === `#${colorHex.toLowerCase()}`
                  ? ``
                  : `,color:"${getColorString(
                      firstPixel.r,
                      firstPixel.g,
                      firstPixel.b,
                      colorSize,
                    )}"`,
              )
              .replace('@text@', '█'.repeat(currentInnerChunk.length));
          }
          return innerText.length > 0 ? innerText.slice(0, -1) : ''; // Remove last comma
        });
    }

    textContent = textContent.length > 0 ? textContent.slice(0, -1) : ''; // Remove last comma

    const currentLineCommandTemp = !isUsingDataMergeCommand
      ? commandTemplate.replace('@text@', textContent).replace(
          '@lineWidth@',
          (isUsingResourcePackFont
            ? 11 + 1
            : widthNeededPerBlock
          ) /*widthNeededPerBlock*/
            .toString(),
        )
      : dataMergeCommandTemplate
          .replace('@text@', textContent)
          .replace('@tag@', `video_frame_target_${i}`);

    const mostAppearedColor = Array.from(currentChunkColorMap.entries()).reduce(
      (a, b) => (a[1] >= b[1] ? a : b),
      ['', 0],
    )[0];
    const currentLineCommand = currentLineCommandTemp.replace(
      '@bgColor@',
      isBackgroundTransparent ? '0x00ffffff' : `0xff${mostAppearedColor}`,
    );
    if (isGenerateWithLineCombinations) {
      const baseY =
        groupLineCount *
          withPaddingLineHeight *
          (pixelsGroupedByMultipleLines.length - i - 1) *
          outputResizeFactor +
        (i === pixelsGroupedByMultipleLines.length - 1
          ? lastChunkBottomPaddingLines *
            withPaddingLineHeight *
            outputResizeFactor
          : 0);

      const filledVertical =
        currentLineCommand.replace('@posY@', baseY.toString()) +
        '\n' +
        currentLineCommand.replace(
          '@posY@',
          (baseY + groupLineCount * withPaddingLineHeight).toString(),
        ) +
        '\n';

      lines.push(
        filledVertical.replaceAll('@posX@', '0'),
        filledVertical.replaceAll('@posX@', blockLeading.toString()),
      );
      if (isUsingDataMergeCommand) {
        entityData.push([
          `video_frame_target_${i}`,
          [0, baseY],
          mostAppearedColor,
        ]);
        if (!isBackgroundTransparent) {
          lines.push(
            bgColorUpdateCommandTemplate
              .replace('@tag@', `video_frame_target_${i}`)
              .replace('@bgColor@', `0xff${mostAppearedColor}`) + '\n',
          );
        }
      }
    } else {
      const posY =
        groupLineCount *
          withPaddingLineHeight *
          (pixelsGroupedByMultipleLines.length - i - 1) +
        (i === pixelsGroupedByMultipleLines.length - 1
          ? lastChunkBottomPaddingLines * withPaddingLineHeight
          : 0);

      lines.push(
        currentLineCommand
          .replaceAll('@posY@', posY.toString())
          .replaceAll('@posX@', '0') + '\n',
      );
      if (isUsingDataMergeCommand) {
        entityData.push([
          `video_frame_target_${i}`,
          [0, posY],
          mostAppearedColor,
        ]);
        if (isBackgroundTransparent) {
          lines.push(
            bgColorUpdateCommandTemplate
              .replace('@tag@', `video_frame_target_${i}`)
              .replace('@bgColor@', `0xff${mostAppearedColor}`) + '\n',
          );
        }
      }
    }
  }
  /*
.replace('@posX@', '0')
*/

  // console.log(`Resized Width: ${resizedWidth}, Resized Height: ${resizedHeight}`);
  await Bun.write(`${outputDir}${prefix}output.mcfunction`, lines.join(''));
  if (isUsingDataMergeCommand) {
    return entityData.map((item) => [
      item[0],
      [item[1][0], item[1][1]],
      resizedWidth * (isUsingResourcePackFont ? 11 + 1 : widthNeededPerBlock),
      isBackgroundTransparent ? '0x00ffffff' : `0xff${item[2]}`,
    ]);
  }
}

// export async function processImage(
//   imagePath: string,
//   outputDir: string,
//   resizeFactor: number,
//   isGenerateWithLineCombinations = false,
//   prefix = '',
// ) {
//   const image = await loadImage(await Bun.file(imagePath).arrayBuffer());

//   const resizedWidth = Math.floor(image.width * resizeFactor);
//   const resizedHeight = Math.floor(image.height * resizeFactor);

//   const canvas = createCanvas(resizedWidth, resizedHeight);
//   const ctx = canvas.getContext('2d');
//   ctx.drawImage(image, 0, 0, resizedWidth, resizedHeight);
//   const colorData = ctx.getImageData(0, 0, resizedWidth, resizedHeight).data;
//   let pixels: Pixel[] = [];

//   for (let i = 0; i < colorData.length; i += 4) {
//     const r = colorData[i];
//     const g = colorData[i + 1];
//     const b = colorData[i + 2];
//     const a = colorData[i + 3];
//     pixels.push({ r, g, b, a } as Pixel);
//   }

//   let PixelsByLine: Array<Pixel>[] = Array.from(
//     { length: resizedHeight },
//     () => [],
//   );

//   for (let y = 0; y < resizedHeight; y++) {
//     for (let x = 0; x < resizedWidth; x++) {
//       const pixel = pixels[y * resizedWidth + x]!;
//       if (pixel) {
//         PixelsByLine[y]!.push(pixel);
//       }
//     }
//   }

//   let maxLineLength = 0;
//   let lines: string[] = [];

//   // Normal Output
//   for (let i = 0; i < PixelsByLine.length; i++) {
//     let textContent = '';

//     const linePixels = PixelsByLine[i]!;
//     const pixelsMergedByColor = mergedPixels(linePixels);
//     for (let j = 0; j < pixelsMergedByColor.length; j++) {
//       const currentChunk = pixelsMergedByColor[j]!;
//       const firstPixel = currentChunk[0]!;
//       const colorHex = (
//         (firstPixel.r << 16) |
//         (firstPixel.g << 8) |
//         firstPixel.b
//       )
//         .toString(16)
//         .padStart(6, '0');
//       textContent += chunkTemplate
//         .replace('@color@', `#${colorHex.toLowerCase()}`)
//         .replace('@text@', '█'.repeat(currentChunk.length));
//     }
//     textContent = textContent.slice(0, -1); // Remove last comma
//     const currentLineCommand = commandTemplate
//       .replace('@text@', textContent)
//       .replace('@posY@', ((PixelsByLine.length - i) * lineHeight).toString())
//       .replace('@lineWidth@', (resizedWidth * widthNeededPerBlock).toString());
//     if (isGenerateWithLineCombinations) {
//       lines.push(
//         currentLineCommand.replaceAll('@posX@', blockLeading.toString()) + '\n',
//       );
//     }
//     lines.push(currentLineCommand.replaceAll('@posX@', '0') + '\n');
//     if (currentLineCommand.length > maxLineLength) {
//       maxLineLength = currentLineCommand.length;
//     }
//   }

//   await Bun.write(`${outputDir}${prefix}output.mcfunction`, lines.join(''));
// }

export interface PixelGroup {
  x: number;
  y: number;
  changeString: string;
  indicator: string;
}

export interface ImageOutput {
  groupedLines: PixelGroup[];
  width: number;
  height: number;
  lineWidth: number;
}

export async function processImageWithCombinedLinesAndJsonOutput(
  imagePath: string,
  outputDir: string,
  resizeFactor: number,
  groupLineCount: number,
  prefix = '',
): Promise<ImageOutput> {
  const image = await loadImage(await Bun.file(imagePath).arrayBuffer());
  const resizedWidth = Math.floor(image.width * resizeFactor);
  const resizedHeight = Math.floor(image.height * resizeFactor);

  const canvas = createCanvas(resizedWidth, resizedHeight);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(image, 0, 0, resizedWidth, resizedHeight);
  const colorData = ctx.getImageData(0, 0, resizedWidth, resizedHeight).data;

  let pixels: Pixel[] = [];

  for (let i = 0; i < colorData.length; i += 4) {
    const r = colorData[i];
    const g = colorData[i + 1];
    const b = colorData[i + 2];
    const a = colorData[i + 3];
    pixels.push({ r, g, b, a } as Pixel);
  }

  let PixelsByLine: Array<Pixel>[] = Array.from(
    { length: resizedHeight },
    () => [],
  );

  for (let y = 0; y < resizedHeight; y++) {
    for (let x = 0; x < resizedWidth; x++) {
      const pixel = pixels[y * resizedWidth + x]!;
      if (pixel) {
        PixelsByLine[y]!.push(pixel);
      }
    }
  }

  // Grouped Output
  const pixelsGroupedByMultipleLines: Array<Pixel>[] = Array.from(
    { length: Math.ceil(PixelsByLine.length / groupLineCount) },
    () => [],
  );

  for (let i = 0; i < PixelsByLine.length; i += groupLineCount) {
    const groupedPixels: Pixel[][] = [];
    for (let j = 0; j < groupLineCount && i + j < PixelsByLine.length; j++) {
      groupedPixels.push(PixelsByLine[i + j]!);
    }
    pixelsGroupedByMultipleLines[Math.floor(i / groupLineCount)] =
      groupedPixels.flat();
  }

  const lastChunkBottomPaddingLines =
    PixelsByLine.length % groupLineCount === 0
      ? 0
      : groupLineCount - (PixelsByLine.length % groupLineCount);

  let Groups: PixelGroup[] = [];

  for (let i = 0; i < pixelsGroupedByMultipleLines.length; i++) {
    let textContent = '';
    const currentIndicator = `video_frame_target_${i}`;
    const commandTemplate = `execute as @e[type=minecraft:text_display,tag=${currentIndicator}] run data modify entity @s text set value [@text@]`;

    let currentGroup: PixelGroup = {
      x: 0,
      y:
        groupLineCount *
          lineHeight *
          (pixelsGroupedByMultipleLines.length - i - 1) +
        (i === pixelsGroupedByMultipleLines.length - 1
          ? lastChunkBottomPaddingLines * lineHeight
          : 0),
      changeString: '',
      indicator: currentIndicator,
    };

    const linePixels = pixelsGroupedByMultipleLines[i]!;
    const pixelsMergedByColor = mergedPixels(linePixels);
    for (let j = 0; j < pixelsMergedByColor.length; j++) {
      const currentChunk = pixelsMergedByColor[j]!;
      const firstPixel = currentChunk[0]!;
      const colorHex = (
        (firstPixel.r << 16) |
        (firstPixel.g << 8) |
        firstPixel.b
      )
        .toString(16)
        .padStart(6, '0');
      textContent += chunkTemplate
        .replace('@color@', `#${colorHex.toLowerCase()}`)
        .replace('@text@', '█'.repeat(currentChunk.length));
    }
    const currentLineString = commandTemplate.replace('@text@', textContent);
    currentGroup.changeString = currentLineString;
    Groups.push(currentGroup);
  }
  /*
.replace('@posX@', '0')
*/

  // console.log(`Resized Width: ${resizedWidth}, Resized Height: ${resizedHeight}`);
  return {
    groupedLines: Groups,
    width: resizedWidth,
    height: resizedHeight,
    lineWidth: resizedWidth * widthNeededPerBlock,
  };
}

if (import.meta.main) {
  const outputDir = './data/display/function/';
  await processImageWithLineCombinations('./img.jpg', outputDir, {
    resizeFactor: 0.1,
    groupLineCount: 20,
    isGenerateWithLineCombinations: true,
    blockGroupThreshold: 50,
    colorSize: ColorSize._256,
  });
  //await processImage('./img.jpg', outputDir, 0.1);
}
