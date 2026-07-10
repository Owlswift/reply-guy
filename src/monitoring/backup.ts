import { db } from "../database/db";
import fs from "fs";
import path from "path";

const BACKUP_DIR = "./backups";
const MAX_BACKUPS = 30;

export function createBackup(): void {
  // Ensure backup directory exists
  if (!fs.existsSync(BACKUP_DIR)) {
    fs.mkdirSync(BACKUP_DIR, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupPath = path.join(BACKUP_DIR, `echo-${timestamp}.db`);

  // Copy database
  fs.copyFileSync("echo.db", backupPath);

  // Clean up old backups
  const backups = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith("echo-") && f.endsWith(".db"))
    .sort()
    .reverse();

  for (const oldBackup of backups.slice(MAX_BACKUPS)) {
    fs.unlinkSync(path.join(BACKUP_DIR, oldBackup));
  }
}

export function restoreBackup(backupName: string): boolean {
  try {
    const backupPath = path.join(BACKUP_DIR, backupName);
    fs.copyFileSync(backupPath, "echo.db");
    return true;
  } catch {
    return false;
  }
}