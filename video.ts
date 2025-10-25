import { $, Glob } from 'bun';
import {
  processImage,
  processImageWithLineCombinations,
  processImageWithCombinedLinesAndJsonOutput,
  type ImageOutput,
} from './image';
import { mkdir } from 'fs/promises';
import { rmdir } from 'fs/promises';
import { existsSync } from 'fs';

// Constants for video rendering positioning
const CHUNK_Y_OFFSET = -0.05;
const CHUNK_X_OFFSET = 0.025;

export async function splitVideoIntoMessageByFrameRate(
  inputPath: string,
  outputDir: string,
  frameRate: number,
) {
  await $`ffmpeg -i ${inputPath} -r ${frameRate} ${outputDir}/frame%04d.png`;
}

export async function splitVP9VideoIntoFrames(
  inputPath: string,
  outputDir: string,
  frameRate: number,
) {
  // Decodes VP9 video (or any video format) into PNG frames
  // FFmpeg automatically detects the input codec (VP9, H.264, etc.)
  // For strict VP9 validation, use ffprobe to check codec before processing
  await $`ffmpeg -i ${inputPath} -r ${frameRate} ${outputDir}/frame%04d.png`;
}

export interface ChunkMetadata {
  frameIndex: number;
  chunkIndex: number;
  x: number;
  y: number;
  width: number;
  height: number;
  indicator: string;
  lineWidth: number;
}

export interface FrameMetadata {
  frameIndex: number;
  width: number;
  height: number;
  chunks: ChunkMetadata[];
}

async function generateVideoFunction(
  inputFilePath: string,
  outputDir: string,
  functionOutputDir: string,
  frameRate: number,
  intervalBetweenFrames: number,
  frameResizeFactor: number,
  VideoModifyFactor = 1,
) {
  if (existsSync(`${outputDir}/function`)) {
    await rmdir(`${outputDir}/function`, { recursive: true });
  }
  if (existsSync(`${outputDir}/frames`)) {
    await rmdir(`${outputDir}/frames`, { recursive: true });
  }

  await mkdir(`${outputDir}/frames`, { recursive: true });
  await mkdir(`${functionOutputDir}/frames`, { recursive: true });

  await splitVideoIntoMessageByFrameRate(
    inputFilePath,
    `${outputDir}/frames`,
    frameRate,
  );
  const scanner = new Glob(`frame*.png`);
  const files = Array.from(scanner.scanSync(`${outputDir}/frames`));
  let frameIndex = 0;
  let functionFiles: string[] = [];
  for (const file of files.slice(
    0,
    Math.floor(files.length * VideoModifyFactor),
  )) {
    const filePath = `${outputDir}/frames/${file}`;
    await processImageWithLineCombinations(
      filePath,
      `${outputDir}/function/frames/`,
      frameResizeFactor,
      100,
      false,
      `frame_${frameIndex}_`,
      50,
    );
    functionFiles.push(`frame_${frameIndex}_output.mcfunction`);
    frameIndex++;
  }

  const lastFrameIndex = frameIndex - 1;
  await Bun.write(
    `${functionOutputDir}/setup_video.mcfunction`,
    `
scoreboard objectives add video_cache dummy
scoreboard objectives add video_system dummy
scoreboard players set current_frame video_system 0
data merge storage video:data {data:{frameIndex:0}}
scoreboard players set last_frame video_system ${lastFrameIndex}
scoreboard players set video_playing video_system 0
    `,
  );

  await Bun.write(
    `${functionOutputDir}/reset_video.mcfunction`,
    `
scoreboard players set current_frame video_system 0
scoreboard players set video_playing video_system 0
data merge storage video {data:{frameIndex:0}}
kill @e[type=text_display,tag=video_frame]
    `,
  );

  await Bun.write(
    `${functionOutputDir}/run_video.mcfunction`,
    `
scoreboard players add @e[type=text_display,tag=video_frame] video_cache 1
execute as @e[type=text_display,tag=video_frame,scores={video_cache=2}] run kill @s
execute as @e[type=minecraft:text_display,tag=video_frame] at @s run tp @s ^ ^ ^-.01
execute if score current_frame video_system >= last_frame video_system run scoreboard players set video_playing video_system 0
execute if score video_playing video_system matches 0 run return run function video:reset_video
scoreboard players add current_frame video_system 1
execute store result storage video:data data.frameIndex int 1 run scoreboard players get current_frame video_system
function video:run_video_frame with storage video:data data
execute positioned ~ ~-0.05 ~ run function video:run_video_frame with storage video:data data
execute positioned ~0.025 ~-0.05 ~ run function video:run_video_frame with storage video:data data
execute positioned ~0.025 ~ ~ run function video:run_video_frame with storage video:data data
schedule function video:run_video ${intervalBetweenFrames}t
`,
  );
  await Bun.write(
    `${functionOutputDir}/run_video_frame.mcfunction`,
    `
$function video:frames/frame_$(frameIndex)_output
    `,
  );
  await Bun.write(
    `${functionOutputDir}/play_video.mcfunction`,
    `
scoreboard players set video_playing video_system 1
function video:run_video
`,
  );
  await Bun.write(
    `${functionOutputDir}/pause_video.mcfunction`,
    `
scoreboard players set video_playing video_system 0
`,
  );
  await Bun.write(
    `${functionOutputDir}/run_frame.mcfunction`,
    `$function video:run_video_frame {frameIndex:$(i)}
$execute positioned ~ ~-0.05 ~ run function video:run_video_frame {frameIndex:$(i)}
$execute positioned ~0.025 ~-0.05 ~ run function video:run_video_frame {frameIndex:$(i)}
$execute positioned ~0.025 ~ ~ run function video:run_video_frame {frameIndex:$(i)}`,
  );

  for (const filePath of files) {
    await Bun.file(`${outputDir}/frames/${filePath}`).delete();
  }
}

async function generateVideoFunctionWithModify(
  inputFilePath: string,
  outputDir: string,
  functionOutputDir: string,
  frameRate: number,
  intervalBetweenFrames: number,
  frameResizeFactor: number,
  VideoModifyFactor = 1,
) {
  if (existsSync(`${outputDir}/function`)) {
    await rmdir(`${outputDir}/function`, { recursive: true });
  }
  if (existsSync(`${outputDir}/frames`)) {
    await rmdir(`${outputDir}/frames`, { recursive: true });
  }

  await mkdir(`${outputDir}/frames`, { recursive: true });
  await mkdir(`${functionOutputDir}/frames`, { recursive: true });

  await splitVideoIntoMessageByFrameRate(
    inputFilePath,
    `${outputDir}/frames`,
    frameRate,
  );
  const scanner = new Glob(`frame*.png`);
  const files = Array.from(scanner.scanSync(`${outputDir}/frames`));
  let frameIndex = 0;
  let fileData: ImageOutput[] = [];

  for (const file of files.slice(
    0,
    Math.floor(files.length * VideoModifyFactor),
  )) {
    const filePath = `${outputDir}/frames/${file}`;
    const result = await processImageWithCombinedLinesAndJsonOutput(
      filePath,
      `${outputDir}/function/frames/`,
      frameResizeFactor,
      100,
      `frame_${frameIndex}_`,
    );
    fileData.push(result);
    frameIndex++;
  }

  for (let i = 0; i < fileData.length; i++) {
    const frame = fileData[i]!;
    const functionLines = frame.groupedLines
      .map((group) => group.changeString)
      .join('\n');
    await Bun.write(
      `${functionOutputDir}/frames/frame_${i}_output.mcfunction`,
      functionLines,
    );
  }

  const lastFrameIndex = frameIndex - 1;

  await Bun.write(
    `${functionOutputDir}/setup_video.mcfunction`,
    `
scoreboard objectives add video_system dummy
scoreboard players set current_frame video_system 0
data merge storage video:data {data:{frameIndex:0}}
scoreboard players set last_frame video_system ${lastFrameIndex}
scoreboard players set video_playing video_system 0
${fileData[0]!.groupedLines
  .map(
    (entity) => `
summon minecraft:text_display ~${entity.x} ~${
      entity.y
    } ~ {Tags:["video_frame","${
      entity.indicator
    }"],text:'',background: 0x00ffffff,width:20000,line_width:${
      fileData[0]!.lineWidth
    }}
summon minecraft:text_display ~${entity.x} ~${
      entity.y - 0.05
    } ~ {Tags:["video_frame","${
      entity.indicator
    }"],text:'',background: 0x00ffffff,width:20000,line_width:${
      fileData[0]!.lineWidth
    }}
summon minecraft:text_display ~${entity.x + 0.025} ~${
      entity.y
    } ~ {Tags:["video_frame","${
      entity.indicator
    }"],text:'',background: 0x00ffffff,width:20000,line_width:${
      fileData[0]!.lineWidth
    }}
summon minecraft:text_display ~${entity.x + 0.025} ~${
      entity.y - 0.05
    } ~ {Tags:["video_frame","${
      entity.indicator
    }"],text:'',background: 0x00ffffff,width:20000,line_width:${
      fileData[0]!.lineWidth
    }}`,
  )
  .join('\n')}`,
  );

  await Bun.write(
    `${functionOutputDir}/reset_video.mcfunction`,
    `
scoreboard players set current_frame video_system 0
scoreboard players set video_playing video_system 0
data merge storage video {data:{frameIndex:0}}
    `,
  );

  await Bun.write(
    `${functionOutputDir}/run_video.mcfunction`,
    `
execute if score current_frame video_system >= last_frame video_system run scoreboard players set video_playing video_system 0
execute if score video_playing video_system matches 0 run return run function video:reset_video
scoreboard players add current_frame video_system 1
execute store result storage video:data data.frameIndex int 1 run scoreboard players get current_frame video_system
function video:run_video_frame with storage video:data data
schedule function video:run_video ${intervalBetweenFrames}t
`,
  );
  await Bun.write(
    `${functionOutputDir}/run_video_frame.mcfunction`,
    `
$execute positioned ~ ~ ~ run function video:frames/frame_$(i)_output
$execute positioned ~ ~-0.05 ~ run function video:frames/frame_$(i)_output
$execute positioned ~0.025 ~-0.05 ~ run function video:frames/frame_$(i)_output
$execute positioned ~0.025 ~ ~ run function video:frames/frame_$(i)_output`,
  );
  await Bun.write(
    `${functionOutputDir}/play_video.mcfunction`,
    `
scoreboard players set video_playing video_system 1
function video:run_video
`,
  );
  await Bun.write(
    `${functionOutputDir}/pause_video.mcfunction`,
    `
scoreboard players set video_playing video_system 0
`,
  );

  for (const filePath of files) {
    await Bun.file(`${outputDir}/frames/${filePath}`).delete();
  }
}

export async function processVP9VideoWithChunkMetadata(
  inputFilePath: string,
  outputDir: string,
  functionOutputDir: string,
  frameRate: number,
  intervalBetweenFrames: number,
  frameResizeFactor: number,
  groupLineCount = 100,
  VideoModifyFactor = 1,
): Promise<FrameMetadata[]> {
  if (existsSync(`${outputDir}/function`)) {
    await rmdir(`${outputDir}/function`, { recursive: true });
  }
  if (existsSync(`${outputDir}/frames`)) {
    await rmdir(`${outputDir}/frames`, { recursive: true });
  }
  if (existsSync(`${outputDir}/metadata`)) {
    await rmdir(`${outputDir}/metadata`, { recursive: true });
  }

  await mkdir(`${outputDir}/frames`, { recursive: true });
  await mkdir(`${functionOutputDir}/frames`, { recursive: true });
  await mkdir(`${outputDir}/metadata`, { recursive: true });

  // Decode VP9 video into frames
  await splitVP9VideoIntoFrames(
    inputFilePath,
    `${outputDir}/frames`,
    frameRate,
  );

  const scanner = new Glob(`frame*.png`);
  const files = Array.from(scanner.scanSync(`${outputDir}/frames`));
  let frameIndex = 0;
  let allFramesMetadata: FrameMetadata[] = [];

  for (const file of files.slice(
    0,
    Math.floor(files.length * VideoModifyFactor),
  )) {
    const filePath = `${outputDir}/frames/${file}`;
    const result = await processImageWithCombinedLinesAndJsonOutput(
      filePath,
      `${outputDir}/function/frames/`,
      frameResizeFactor,
      groupLineCount,
      `frame_${frameIndex}_`,
    );

    // Convert ImageOutput to FrameMetadata with chunk information
    const totalChunks = result.groupedLines.length;
    const frameMetadata: FrameMetadata = {
      frameIndex,
      width: result.width,
      height: result.height,
      chunks: result.groupedLines.map((group, chunkIndex) => {
        // Calculate chunk height more accurately
        // The last chunk may have fewer lines if groupLineCount doesn't divide evenly
        const isLastChunk = chunkIndex === totalChunks - 1;
        const baseChunkHeight = Math.floor(result.height / totalChunks);
        const remainingHeight = result.height - (baseChunkHeight * (totalChunks - 1));
        const chunkHeight = isLastChunk ? remainingHeight : baseChunkHeight;
        
        return {
          frameIndex,
          chunkIndex,
          x: group.x,
          y: group.y,
          width: result.width,
          height: chunkHeight,
          indicator: group.indicator,
          lineWidth: result.lineWidth,
        };
      }),
    };

    allFramesMetadata.push(frameMetadata);

    // Generate the function file for this frame
    const functionLines = result.groupedLines
      .map((group) => group.changeString)
      .join('\n');
    await Bun.write(
      `${functionOutputDir}/frames/frame_${frameIndex}_output.mcfunction`,
      functionLines,
    );

    frameIndex++;
  }

  const lastFrameIndex = frameIndex - 1;

  // Write metadata JSON file
  await Bun.write(
    `${outputDir}/metadata/frames_metadata.json`,
    JSON.stringify(allFramesMetadata, null, 2),
  );

  // Generate setup function with text_display entities
  await Bun.write(
    `${functionOutputDir}/setup_video.mcfunction`,
    `
scoreboard objectives add video_system dummy
scoreboard players set current_frame video_system 0
data merge storage video:data {data:{frameIndex:0}}
scoreboard players set last_frame video_system ${lastFrameIndex}
scoreboard players set video_playing video_system 0
${allFramesMetadata[0]!.chunks
  .map(
    (chunk) => `
summon minecraft:text_display ~${chunk.x} ~${
      chunk.y
    } ~ {Tags:["video_frame","${
      chunk.indicator
    }"],text:'',background: 0x00ffffff,width:20000,line_width:${chunk.lineWidth}}
summon minecraft:text_display ~${chunk.x} ~${
      chunk.y + CHUNK_Y_OFFSET
    } ~ {Tags:["video_frame","${
      chunk.indicator
    }"],text:'',background: 0x00ffffff,width:20000,line_width:${chunk.lineWidth}}
summon minecraft:text_display ~${chunk.x + CHUNK_X_OFFSET} ~${
      chunk.y
    } ~ {Tags:["video_frame","${
      chunk.indicator
    }"],text:'',background: 0x00ffffff,width:20000,line_width:${chunk.lineWidth}}
summon minecraft:text_display ~${chunk.x + CHUNK_X_OFFSET} ~${
      chunk.y + CHUNK_Y_OFFSET
    } ~ {Tags:["video_frame","${
      chunk.indicator
    }"],text:'',background: 0x00ffffff,width:20000,line_width:${chunk.lineWidth}}`,
  )
  .join('\n')}`,
  );

  // Generate control functions
  await Bun.write(
    `${functionOutputDir}/reset_video.mcfunction`,
    `
scoreboard players set current_frame video_system 0
scoreboard players set video_playing video_system 0
data merge storage video:data {data:{frameIndex:0}}
    `,
  );

  await Bun.write(
    `${functionOutputDir}/run_video.mcfunction`,
    `
execute if score current_frame video_system >= last_frame video_system run scoreboard players set video_playing video_system 0
execute if score video_playing video_system matches 0 run return run function video:reset_video
scoreboard players add current_frame video_system 1
execute store result storage video:data data.frameIndex int 1 run scoreboard players get current_frame video_system
function video:run_video_frame with storage video:data data
schedule function video:run_video ${intervalBetweenFrames}t
`,
  );

  await Bun.write(
    `${functionOutputDir}/run_video_frame.mcfunction`,
    `
$execute positioned ~ ~ ~ run function video:frames/frame_$(i)_output
$execute positioned ~ ~${CHUNK_Y_OFFSET} ~ run function video:frames/frame_$(i)_output
$execute positioned ~${CHUNK_X_OFFSET} ~${CHUNK_Y_OFFSET} ~ run function video:frames/frame_$(i)_output
$execute positioned ~${CHUNK_X_OFFSET} ~ ~ run function video:frames/frame_$(i)_output`,
  );

  await Bun.write(
    `${functionOutputDir}/play_video.mcfunction`,
    `
scoreboard players set video_playing video_system 1
function video:run_video
`,
  );

  await Bun.write(
    `${functionOutputDir}/pause_video.mcfunction`,
    `
scoreboard players set video_playing video_system 0
`,
  );

  // Clean up frame images
  for (const filePath of files) {
    await Bun.file(`${outputDir}/frames/${filePath}`).delete();
  }

  return allFramesMetadata;
}

if (import.meta.main) {
  const inputFilePath = './BGM_744326.mp4';
  const outputDir = './data/video';
  const functionOutputDir = `${outputDir}/function`;
  const frameRate = 10;
  const intervalBetweenFrames = 20 / frameRate;
  const frameResizeFactor = 0.34;
  const VideoModifyFactor = 1;
  
  // Example 1: Standard video processing
  // await generateVideoFunction(
  //   inputFilePath,
  //   outputDir,
  //   functionOutputDir,
  //   frameRate,
  //   intervalBetweenFrames,
  //   frameResizeFactor,
  //   VideoModifyFactor,
  // );
  
  // Example 2: Video processing with modify
  // await generateVideoFunctionWithModify(
  //   inputFilePath,
  //   outputDir,
  //   functionOutputDir,
  //   frameRate,
  //   intervalBetweenFrames,
  //   frameResizeFactor,
  //   VideoModifyFactor,
  // );
  
  // Example 3: VP9 video processing with chunk metadata output
  const metadata = await processVP9VideoWithChunkMetadata(
    inputFilePath,
    outputDir,
    functionOutputDir,
    frameRate,
    intervalBetweenFrames,
    frameResizeFactor,
    100, // groupLineCount for chunk grouping
    VideoModifyFactor,
  );
  
  console.log(`Processed ${metadata.length} frames with chunk metadata`);
  console.log(`Metadata saved to: ${outputDir}/metadata/frames_metadata.json`);
}
