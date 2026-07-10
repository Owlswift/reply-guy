import { QueueItem } from "./queue";
import { Relationship } from "../relationship/types";

// Priority levels
export type Priority = 1 | 2 | 3;

export interface PriorityItem extends QueueItem {
  priority: Priority;
}

// Three priority queues
const priorityQueues: Record<Priority, PriorityItem[]> = {
  1: [], // Mutuals and Following
  2: [], // High-quality discovery
  3: []  // Everything else
};

export function enqueueWithPriority(item: PriorityItem): void {
  priorityQueues[item.priority].push(item);
}

export function dequeueHighestPriority(): PriorityItem | undefined {
  // Always check priority 1 first
  if (priorityQueues[1].length > 0) {
    return priorityQueues[1].shift();
  }
  
  // Then priority 2
  if (priorityQueues[2].length > 0) {
    return priorityQueues[2].shift();
  }
  
  // Then priority 3
  if (priorityQueues[3].length > 0) {
    return priorityQueues[3].shift();
  }
  
  return undefined;
}

export function getQueueSize(): number {
  return priorityQueues[1].length + priorityQueues[2].length + priorityQueues[3].length;
}

export function getPrioritySizes(): { p1: number; p2: number; p3: number } {
  return {
    p1: priorityQueues[1].length,
    p2: priorityQueues[2].length,
    p3: priorityQueues[3].length
  };
}

export function calculatePriority(relationship: Relationship, quality: number): Priority {
  // Priority 1: Mutuals and Following
  if (relationship === "mutual" || relationship === "following") {
    return 1;
  }
  
  // Priority 2: High-quality tweets
  if (quality >= 70) {
    return 2;
  }
  
  // Priority 3: Everything else
  return 3;
}