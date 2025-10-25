# creating Image/Video By text_display

## Installation

1. Download as Zip and unpack to \<saves\>/\<map\>/datapack/...
2. Install JS Runtime [Bun](https://bun.sh) (you can use other runtime but need some change at both /image.ts and /video.ts)
3. Install Dependency
```bash
bun i
```
4. Install FFmpeg (Use to get the Video Frame)
5. Run it by 
```bash
bun video.ts
```

## Useage

### Process Image

1. Put image file at datapack folder
2. Change `image.ts` 
```ts
if (import.meta.main) {
  const outputDir = './data/display/function/';
  await processImageWithLineCombinations('./<your_file_name>', outputDir, <resize>);
  //await processImage('./<your_file_name>', outputDir, 0.1);
}
```
3. Use it in game (`/function display:output`)

### Process Video

1. Put video file at datapack folder
2. Change `video.ts`
```ts
if (import.meta.main) {
  const inputFilePath = './<your_file_name>';
  const outputDir = './data/video';
  const functionOutputDir = `${outputDir}/function`;
  const frameRate = <frame_rate>;
  const intervalBetweenFrames = 20 / frameRate;
  const frameResizeFactor = <resize>;
  // There are three methods you can choose from:
  
  // Method 1: Standard video processing
  // await generateVideoFunction(
  //   inputFilePath,
  //   outputDir,
  //   functionOutputDir,
  //   frameRate,
  //   intervalBetweenFrames,
  //   frameResizeFactor,
  // );
  
  // Method 2: Video processing with modify
  // await generateVideoFunctionWithModify(
  //   inputFilePath,
  //   outputDir,
  //   functionOutputDir,
  //   frameRate,
  //   intervalBetweenFrames,
  //   frameResizeFactor,
  // );
  
  // Method 3: VP9 video with chunk metadata (NEW!)
  await processVP9VideoWithChunkMetadata(
    inputFilePath,
    outputDir,
    functionOutputDir,
    frameRate,
    intervalBetweenFrames,
    frameResizeFactor,
    100, // groupLineCount
  );
}
```
3. Change `/datapack/video/functions/frames` size
If it about 500 MB your Minecraft needs at lesat 16GB
If it about 1GB your Minecraft needs at lesat 24GB (In my PC)
4. ***Important** Save Map
5. ***Important** Entering the Map
6. Setup position by change worldspawn(if below 1.21.10, it will always stay at 0,0,0) `/setworldspawn ~ ~ ~`
7. Setup scores and entities By `function video:setup_video`
8. Play it `function video:play_video`
9. Pause And Reset `function video:pause_video`

### Process VP9 Video with Chunk Metadata (NEW!)

For VP9 videos with detailed chunk position and dimension output, see [VP9_DECODE.md](VP9_DECODE.md) for detailed documentation.

This new method:
- Decodes VP9 videos specifically with the VP9 codec
- Generates JSON metadata with position (x, y) and dimensions (width, height) for each chunk
- Outputs chunk information for efficient Minecraft rendering
- Creates text_display entities with background colors for chunk-based rendering

* The reason why don't use `/reload` to update datapacks is due to it always make game crash or out of memory in my PC, so that I don't recommend.

## About and Other things

This repo might have some problem deal with Image that I haven't test it out.
Don't mind creating issue or contact me by Discord (pikacnu)