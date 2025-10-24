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

export async function splitVideoIntoMessageByFrameRate(
  inputPath: string,
  outputDir: string,
  frameRate: number,
) {
  await $`ffmpeg -i ${inputPath} -r ${frameRate} ${outputDir}/frame%04d.png`;
}

async function generateVideoFunction(
  inputFilePath: string,
  outputDir: string,
  functionOutputDir: string,
  frameRate: number,
  intervalBetweenFrames: number,
  frameResizeFactor: number,
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
  for (const file of files.slice(0, Math.floor(files.length / 1))) {
    const filePath = `${outputDir}/frames/${file}`;
    await processImage(
      filePath,
      `${outputDir}/function/frames/`,
      frameResizeFactor,
      false,
      `frame_${frameIndex}_`,
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
execute as @e[type=text_display,tag=video_frame,scores={video_cache=3}] run kill @s
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

  for (const file of files.slice(0, Math.floor(files.length / 1))) {
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

  for (const filePath of files) {
    await Bun.file(`${outputDir}/frames/${filePath}`).delete();
  }
}

if (import.meta.main) {
  const inputFilePath = './source.mp4';
  const outputDir = './data/video';
  const functionOutputDir = `${outputDir}/function`;
  const frameRate = 10;
  const intervalBetweenFrames = 20 / frameRate;
  const frameResizeFactor = 0.1;
  await generateVideoFunction(
    inputFilePath,
    outputDir,
    functionOutputDir,
    frameRate,
    intervalBetweenFrames,
    frameResizeFactor,
  );
  // await generateVideoFunctionWithModify(
  //   inputFilePath,
  //   outputDir,
  //   functionOutputDir,
  //   frameRate,
  //   intervalBetweenFrames,
  //   frameResizeFactor,
  // );
}
