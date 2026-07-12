import * as fs from "fs";
import * as path from "path";
import * as os from "os";

/**
 * Download an image from a URL to a temporary file.
 * Returns the local file path.
 */
export async function downloadImage(url: string): Promise<string> {
  const response = await fetch(url);
  const buffer = Buffer.from(await response.arrayBuffer());
  
  const ext = path.extname(new URL(url).pathname) || ".jpg";
  const tmpFile = path.join(os.tmpdir(), `echo-vision-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  
  fs.writeFileSync(tmpFile, buffer);
  return tmpFile;
}

/**
 * Download multiple images and return local file paths.
 */
export async function downloadImages(urls: string[]): Promise<string[]> {
  return Promise.all(urls.map(downloadImage));
}

/**
 * Clean up temporary image files.
 */
export function cleanupImages(paths: string[]): void {
  for (const p of paths) {
    try {
      fs.unlinkSync(p);
    } catch {
      // Ignore cleanup errors
    }
  }
}