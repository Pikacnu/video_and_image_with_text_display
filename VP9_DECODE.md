# VP9 Video Decoding with Chunk Metadata

This document describes the new VP9 video decoding functionality that generates position and width/height output for chunk-based rendering in Minecraft.

## Overview

The new `processVP9VideoWithChunkMetadata` function decodes VP9 videos and generates:
1. Position (x, y) coordinates for each chunk
2. Width and height dimensions for each chunk
3. Frame metadata in JSON format
4. Minecraft function files for rendering

## Usage

### Basic Example

```typescript
import { processVP9VideoWithChunkMetadata } from './video';

const metadata = await processVP9VideoWithChunkMetadata(
  './your_vp9_video.mp4',      // Input VP9 video file
  './data/video',               // Output directory
  './data/video/function',      // Function output directory
  10,                           // Frame rate (fps)
  2,                            // Interval between frames (ticks)
  0.34,                         // Resize factor (0-1)
  100,                          // Group line count for chunking
  1,                            // Video modify factor (0-1)
);

console.log(`Processed ${metadata.length} frames`);
```

### Output Structure

The function generates the following outputs:

1. **Metadata JSON** (`data/video/metadata/frames_metadata.json`):
```json
[
  {
    "frameIndex": 0,
    "width": 340,
    "height": 192,
    "chunks": [
      {
        "frameIndex": 0,
        "chunkIndex": 0,
        "x": 0,
        "y": 0.4,
        "width": 340,
        "height": 64,
        "indicator": "video_frame_target_0",
        "lineWidth": 3060
      }
    ]
  }
]
```

2. **Minecraft Function Files** (`data/video/function/frames/`):
   - `frame_0_output.mcfunction`
   - `frame_1_output.mcfunction`
   - etc.

3. **Control Functions**:
   - `setup_video.mcfunction` - Initializes video system and spawns text_display entities
   - `play_video.mcfunction` - Starts video playback
   - `pause_video.mcfunction` - Pauses video playback
   - `reset_video.mcfunction` - Resets video to beginning

## Chunk Metadata Structure

Each chunk contains:
- `frameIndex`: Frame number (0-based)
- `chunkIndex`: Chunk number within the frame (0-based)
- `x`: X position offset from world spawn
- `y`: Y position offset from world spawn
- `width`: Width of the chunk in pixels
- `height`: Height of the chunk in pixels (approximate)
- `indicator`: Tag identifier for the text_display entity
- `lineWidth`: Line width for the text_display entity

## How It Works

1. **VP9 Decoding**: The function uses FFmpeg with VP9 codec to extract frames:
   ```bash
   ffmpeg -i input.mp4 -vcodec vp9 -r <framerate> output/frame%04d.png
   ```

2. **Frame Processing**: Each frame is processed into chunks based on `groupLineCount`:
   - Groups multiple lines into chunks for better performance
   - Converts pixels to colored text characters
   - Generates position and dimension metadata

3. **Chunk Rendering**: Uses Minecraft text_display entities with:
   - Background color simulation
   - Precise positioning based on metadata
   - Efficient updates using tags and indicators

## Minecraft Setup

1. Load the datapack in your Minecraft world
2. Run `/function video:setup_video` to initialize
3. Set world spawn: `/setworldspawn ~ ~ ~`
4. Play video: `/function video:play_video`
5. Pause: `/function video:pause_video`

## Parameters

- **frameRate**: Video frame rate (affects extraction rate)
- **intervalBetweenFrames**: Minecraft ticks between frames (20 ticks = 1 second)
- **frameResizeFactor**: Scale factor for frames (smaller = better performance)
- **groupLineCount**: Number of lines per chunk (higher = fewer entities, lower quality)
- **VideoModifyFactor**: Portion of video to process (1 = full video, 0.5 = first half)

## Performance Tips

- Use higher `groupLineCount` (150-200) for better performance
- Reduce `frameResizeFactor` to decrease resolution
- Lower `frameRate` to reduce total frames
- Minecraft requires significant RAM (16GB+ for 500MB, 24GB+ for 1GB)
- Save and reload the world rather than using `/reload`
