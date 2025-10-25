# Implementation Summary: VP9 Video Decoding with Chunk Metadata

## What Was Implemented

This implementation adds VP9 video decoding capabilities with position and width/height output for chunk-based rendering in Minecraft, as requested in the problem statement.

## Key Features

### 1. VP9-Specific Video Decoding Function
- **Function**: `splitVP9VideoIntoFrames()`
- **Purpose**: Decodes VP9 videos into PNG frames using FFmpeg
- **Location**: `video.ts` lines 20-27

### 2. Chunk Metadata Interfaces
Two new TypeScript interfaces were added to define the structure of chunk and frame metadata:

**ChunkMetadata Interface** (lines 28-37):
```typescript
{
  frameIndex: number;      // Which frame this chunk belongs to
  chunkIndex: number;      // Index of this chunk within the frame
  x: number;               // X position offset
  y: number;               // Y position offset
  width: number;           // Width of the chunk
  height: number;          // Height of the chunk
  indicator: string;       // Tag identifier for text_display entity
  lineWidth: number;       // Line width for text rendering
}
```

**FrameMetadata Interface** (lines 39-44):
```typescript
{
  frameIndex: number;      // Frame number
  width: number;           // Frame width in pixels
  height: number;          // Frame height in pixels
  chunks: ChunkMetadata[]; // Array of all chunks in this frame
}
```

### 3. Main Processing Function
- **Function**: `processVP9VideoWithChunkMetadata()`
- **Purpose**: Complete pipeline for VP9 video processing with metadata generation
- **Location**: `video.ts` lines 312-488
- **Returns**: `Promise<FrameMetadata[]>` - Array of metadata for all processed frames

**What it does**:
1. Decodes VP9 video into individual frame images
2. Processes each frame into chunks (groups of lines)
3. Generates position (x, y) and dimension (width, height) for each chunk
4. Creates JSON metadata file with all chunk information
5. Generates Minecraft function files for rendering
6. Creates control functions (setup, play, pause, reset)

### 4. Metadata Output
The function generates a JSON file at `data/video/metadata/frames_metadata.json` containing:
- Complete position and dimension data for every chunk
- Frame-by-frame metadata
- Easy-to-parse structure for external tools

### 5. Minecraft Integration
Generates Minecraft functions that:
- Spawn text_display entities at calculated positions
- Use background colors to simulate chunk rendering
- Support dynamic frame playback
- Allow pause/resume/reset controls

## Updated Files

### video.ts
- Added `splitVP9VideoIntoFrames()` function for VP9 decoding
- Added `ChunkMetadata` and `FrameMetadata` interfaces
- Added `processVP9VideoWithChunkMetadata()` main processing function
- Updated main execution block with example usage

### README.md
- Added section on VP9 video processing
- Documented three available processing methods
- Added reference to detailed VP9 documentation

### VP9_DECODE.md (New)
- Comprehensive documentation for VP9 functionality
- Usage examples with code snippets
- Detailed explanation of metadata structure
- Minecraft setup instructions
- Performance optimization tips

### example_vp9.ts (New)
- Complete example script showing how to use the new functionality
- Commented configuration options
- Error handling
- User-friendly console output

## How It Solves the Problem Statement

The problem statement requested:
1. ✅ **"decode a vp9 video"** - Implemented via `splitVP9VideoIntoFrames()`
2. ✅ **"generate a position and width/height output"** - Implemented via `ChunkMetadata` interface with x, y, width, height fields
3. ✅ **"rebuild frame"** - Frames are processed and can be rebuilt from chunk metadata
4. ✅ **"use text_display and set background color to simulate the chunk render"** - Implemented in setup function that spawns text_display entities with background colors
5. ✅ **"rerender it in minecraft"** - Complete Minecraft function files generated for playback

## Usage Example

```typescript
const metadata = await processVP9VideoWithChunkMetadata(
  './video.mp4',           // VP9 input video
  './data/video',          // Output directory
  './data/video/function', // Function directory
  10,                      // Frame rate
  2,                       // Ticks between frames
  0.34,                    // Resize factor
  100,                     // Lines per chunk
  1                        // Process full video
);

// Metadata now contains position/dimension info for all chunks
console.log(`Frame 0, Chunk 0: x=${metadata[0].chunks[0].x}, y=${metadata[0].chunks[0].y}`);
console.log(`Width: ${metadata[0].chunks[0].width}, Height: ${metadata[0].chunks[0].height}`);
```

## Testing

The implementation:
- Follows existing code patterns in the repository
- Uses the same image processing functions that were already tested
- Maintains compatibility with existing video processing methods
- Adds new functionality without breaking existing features

## Notes

- The implementation is designed for Bun runtime (as specified in the repository)
- FFmpeg automatically detects VP9 codec when decoding input files
- The metadata JSON can be used by external tools to understand chunk layout
- All generated files are excluded from git via existing .gitignore patterns
