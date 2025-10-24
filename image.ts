import { createCanvas, loadImage } from '@napi-rs/canvas';

export type Pixel = { r: number; g: number; b: number; a: number };

const mergedPixels = (pixels: Pixel[]): Array<Pixel[]> =>
  pixels.reduce((acc: Array<Pixel[]>, pixel) => {
    if (acc.length === 0) {
      acc.push([pixel]);
      return acc;
    }
    const lastGroup = acc[acc.length - 1]!;
    const lastPixel = lastGroup[0]!;
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

const commandTemplate =
  'summon minecraft:text_display ~@posX@ ~@posY@ ~ {Tags:["video_frame"],text:[@text@],background:' +
  '0x00ffffff' +
  ',width:20000,line_width:@lineWidth@}';
const chunkTemplate = '{text:"@text@",color:"@color@"},';
const lineHeight = 0.2;
const blockLeading = 0.025;
const withPaddingLineHeight = 0.25;
const widthNeededPerBlock = 9;

export async function processImageWithLineCombinations(
  imagePath: string,
  outputDir: string,
  resizeFactor: number,
  isGenerateWithLineCombinations = false,
  prefix = '',
) {
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

  let maxLineLength = 0;

  // Grouped Output
  const groupLineCount = 100;
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

  for (let i = 0; i < pixelsGroupedByMultipleLines.length; i++) {
    let textContent = '';

    const linePixels = pixelsGroupedByMultipleLines[i]!;
    // console.log(
    //   `Processing grouped line ${i} with ${linePixels.length} pixels | ${
    //     linePixels.length / groupLineCount
    //   } per line`,
    // );
    const pixelsMergedByColor = mergedPixels(linePixels);
    let tempLength = 0;
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
      tempLength += currentChunk.length;
    }
    const currentLineCommand = commandTemplate
      .replace('@text@', textContent)
      .replace('@lineWidth@', (resizedWidth * widthNeededPerBlock).toString());
    if (isGenerateWithLineCombinations) {
      const filledVertical =
        currentLineCommand.replace(
          '@posY@',
          (
            groupLineCount *
              withPaddingLineHeight *
              (pixelsGroupedByMultipleLines.length - i - 1) +
            (i === pixelsGroupedByMultipleLines.length - 1
              ? lastChunkBottomPaddingLines * withPaddingLineHeight
              : 0)
          ).toString(),
        ) +
        '\n' +
        currentLineCommand.replace(
          '@posY@',
          (
            groupLineCount *
              withPaddingLineHeight *
              (pixelsGroupedByMultipleLines.length - i - 1) -
            blockLeading * 2 +
            (i === pixelsGroupedByMultipleLines.length - 1
              ? lastChunkBottomPaddingLines * withPaddingLineHeight
              : 0)
          ).toString(),
        ) +
        '\n';
      lines.push(
        filledVertical.replaceAll('@posX@', '0'),
        filledVertical.replaceAll('@posX@', blockLeading.toString()),
      );
    } else {
      lines.push(
        currentLineCommand
          .replaceAll(
            '@posY@',
            (
              groupLineCount *
                lineHeight *
                (pixelsGroupedByMultipleLines.length - i - 1) +
              (i === pixelsGroupedByMultipleLines.length - 1
                ? lastChunkBottomPaddingLines * lineHeight
                : 0)
            ).toString(),
          )
          .replaceAll('@posX@', '0') + '\n',
      );
    }

    maxLineLength = Math.max(maxLineLength, currentLineCommand.length);
  }
  /*
.replace('@posX@', '0')
*/

  maxLineLength = 0;
  // console.log(`Resized Width: ${resizedWidth}, Resized Height: ${resizedHeight}`);
  await Bun.write(`${outputDir}${prefix}output.mcfunction`, lines.join(''));
}

export async function processImage(
  imagePath: string,
  outputDir: string,
  resizeFactor: number,
  isGenerateWithLineCombinations = false,
  prefix = '',
) {
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

  let maxLineLength = 0;
  let lines: string[] = [];

  // Normal Output
  for (let i = 0; i < PixelsByLine.length; i++) {
    let textContent = '';

    const linePixels = PixelsByLine[i]!;
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
    textContent = textContent.slice(0, -1); // Remove last comma
    const currentLineCommand = commandTemplate
      .replace('@text@', textContent)
      .replace('@posY@', ((PixelsByLine.length - i) * lineHeight).toString())
      .replace('@lineWidth@', (resizedWidth * widthNeededPerBlock).toString());
    if (isGenerateWithLineCombinations) {
      lines.push(
        currentLineCommand.replaceAll('@posX@', blockLeading.toString()) + '\n',
      );
    }
    lines.push(currentLineCommand.replaceAll('@posX@', '0') + '\n');
    if (currentLineCommand.length > maxLineLength) {
      maxLineLength = currentLineCommand.length;
    }
  }

  await Bun.write(`${outputDir}${prefix}output.mcfunction`, lines.join(''));
}

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
  await processImageWithLineCombinations('./img.jpg', outputDir, 0.1);
  //await processImage('./img.jpg', outputDir, 0.1);
}
