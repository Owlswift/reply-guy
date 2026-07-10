export const config = {
  replyDelayMin: 45,
  replyDelayMax: 180,
  maxRepliesPerHour: 18,
  maxRepliesPerDay: 220,
  workingHours: {
    start: "07:30",
    end: "23:00"
  },
  model: "qwen3:8b",
  ollamaUrl: "http://localhost:11434/api/generate",
  dryRun: true,
  maxRetries: 2,
  healthCheckInterval: 30000,
  backupInterval: 24 * 60 * 60 * 1000
};

export function isWorkingHours(): boolean {
  const now = new Date();
  const hour = now.getHours();
  const minute = now.getMinutes();
  const currentMinutes = hour * 60 + minute;
  
  const startParts = config.workingHours.start.split(":");
  const endParts = config.workingHours.end.split(":");
  
  const startHour = Number(startParts[0]) || 0;
  const startMin = Number(startParts[1]) || 0;
  const endHour = Number(endParts[0]) || 0;
  const endMin = Number(endParts[1]) || 0;
  
  const startMinutes = startHour * 60 + startMin;
  const endMinutes = endHour * 60 + endMin;
  
  return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
}
