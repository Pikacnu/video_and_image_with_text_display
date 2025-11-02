/**
 * Worker for parallel image processing
 * Handles image loading, block detection, and optimization
 */

import { processAndGroupImage } from './image_group_processer.ts';
import type { Block } from './image_group_processer.ts';

export interface WorkerTask {
  id: number;
  imagePath: string;
  resizeFactor: number;
  sortBy: 'area' | 'y_x';
}

export interface WorkerResult {
  id: number;
  blocks: Block[];
  error?: string;
}

declare const self: Worker;

// Handle messages from main thread
self.addEventListener('message', async (event: MessageEvent<WorkerTask>) => {
  const { id, imagePath, resizeFactor, sortBy } = event.data;

  try {
    const blocks = await processAndGroupImage(imagePath, {
      resizeFactor,
      sortBy,
    });

    const result: WorkerResult = {
      id,
      blocks,
    };

    self.postMessage(result);
  } catch (error) {
    const result: WorkerResult = {
      id,
      blocks: [],
      error: error instanceof Error ? error.message : String(error),
    };

    self.postMessage(result);
  }
});
