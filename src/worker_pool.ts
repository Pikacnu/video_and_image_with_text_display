/**
 * Worker Pool for parallel image processing
 */

import { cpus } from 'node:os';
import type { WorkerTask, WorkerResult } from './image_worker.ts';
import type { Block } from './image_group_processer.ts';

export class ImageWorkerPool {
  private workers: Worker[] = [];
  private availableWorkers: Worker[] = [];
  private taskQueue: Array<{
    task: WorkerTask;
    resolve: (blocks: Block[]) => void;
    reject: (error: Error) => void;
  }> = [];
  private poolSize: number;

  constructor(poolSize: number = cpus().length) {
    this.poolSize = poolSize;
    this.initializeWorkers();
  }

  private initializeWorkers() {
    const workerPath = new URL('./image_worker.ts', import.meta.url).href;

    for (let i = 0; i < this.poolSize; i++) {
      const worker = new Worker(workerPath);

      worker.addEventListener(
        'message',
        (event: MessageEvent<WorkerResult>) => {
          const { id, blocks, error } = event.data;

          // Find and resolve the corresponding task
          const taskIndex = this.taskQueue.findIndex((t) => t.task.id === id);
          if (taskIndex !== -1) {
            const { resolve, reject } = this.taskQueue[taskIndex]!;
            this.taskQueue.splice(taskIndex, 1);

            if (error) {
              reject(new Error(error));
            } else {
              resolve(blocks);
            }
          }

          // Mark worker as available and process next task
          this.availableWorkers.push(worker);
          this.processNextTask();
        },
      );

      this.workers.push(worker);
      this.availableWorkers.push(worker);
    }
  }

  private processNextTask() {
    if (this.taskQueue.length === 0 || this.availableWorkers.length === 0) {
      return;
    }

    const worker = this.availableWorkers.pop()!;
    const taskEntry = this.taskQueue.find((t) => !('worker' in t));

    if (taskEntry) {
      (taskEntry as any).worker = worker;
      worker.postMessage(taskEntry.task);
    }
  }

  async processImage(
    imagePath: string,
    resizeFactor: number,
    sortBy: 'area' | 'y_x' = 'area',
  ): Promise<Block[]> {
    return new Promise((resolve, reject) => {
      const task: WorkerTask = {
        id: Date.now() + Math.random(), // Unique ID
        imagePath,
        resizeFactor,
        sortBy,
      };

      this.taskQueue.push({ task, resolve, reject });
      this.processNextTask();
    });
  }

  async terminate() {
    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers = [];
    this.availableWorkers = [];
    this.taskQueue = [];
  }

  getPoolSize(): number {
    return this.poolSize;
  }

  getActiveWorkers(): number {
    return this.poolSize - this.availableWorkers.length;
  }
}
