#!/usr/bin/env bun
/**
 * Example script demonstrating VP9 video processing with chunk metadata
 * 
 * This script shows how to use the new processVP9VideoWithChunkMetadata function
 * to decode a VP9 video and generate position/dimension metadata for Minecraft.
 * 
 * Usage:
 *   1. Place your VP9 video file in the datapack folder
 *   2. Update the inputFilePath below
 *   3. Run: bun example_vp9.ts
 */

import { processVP9VideoWithChunkMetadata } from './video';

async function main() {
  // Configuration
  const inputFilePath = './your_vp9_video.mp4'; // Change this to your video file
  const outputDir = './data/video';
  const functionOutputDir = `${outputDir}/function`;
  
  // Video processing settings
  const frameRate = 10;                    // Extract 10 frames per second
  const intervalBetweenFrames = 2;         // 2 ticks between frames (20 ticks = 1 second)
  const frameResizeFactor = 0.34;          // Scale to 34% of original size
  const groupLineCount = 100;              // Group 100 lines into each chunk
  const VideoModifyFactor = 1;             // Process entire video (use 0.5 for first half)

  console.log('Starting VP9 video processing...');
  console.log(`Input file: ${inputFilePath}`);
  console.log(`Output directory: ${outputDir}`);
  console.log(`Frame rate: ${frameRate} fps`);
  console.log(`Resize factor: ${frameResizeFactor}`);
  console.log('');

  try {
    // Process the VP9 video
    const metadata = await processVP9VideoWithChunkMetadata(
      inputFilePath,
      outputDir,
      functionOutputDir,
      frameRate,
      intervalBetweenFrames,
      frameResizeFactor,
      groupLineCount,
      VideoModifyFactor,
    );

    // Display results
    console.log('✓ Processing complete!');
    console.log('');
    console.log(`Total frames processed: ${metadata.length}`);
    console.log(`Metadata file: ${outputDir}/metadata/frames_metadata.json`);
    console.log('');
    
    // Show sample of first frame metadata
    if (metadata.length > 0) {
      const firstFrame = metadata[0]!;
      console.log('First frame info:');
      console.log(`  - Dimensions: ${firstFrame.width}x${firstFrame.height}`);
      console.log(`  - Chunks: ${firstFrame.chunks.length}`);
      console.log('');
      console.log('Sample chunk (first chunk of first frame):');
      const firstChunk = firstFrame.chunks[0]!;
      console.log(`  - Position: (x=${firstChunk.x}, y=${firstChunk.y})`);
      console.log(`  - Size: ${firstChunk.width}x${firstChunk.height}`);
      console.log(`  - Indicator: ${firstChunk.indicator}`);
      console.log(`  - Line width: ${firstChunk.lineWidth}`);
      console.log('');
    }

    // Next steps
    console.log('Next steps:');
    console.log('1. Load the datapack in your Minecraft world');
    console.log('2. Run: /function video:setup_video');
    console.log('3. Set spawn: /setworldspawn ~ ~ ~');
    console.log('4. Play video: /function video:play_video');
    console.log('5. Pause: /function video:pause_video');

  } catch (error) {
    console.error('Error processing video:', error);
    process.exit(1);
  }
}

// Run the script
if (import.meta.main) {
  main();
}
