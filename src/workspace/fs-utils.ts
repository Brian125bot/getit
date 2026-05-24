import * as fsp from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';

/**
 * Writes data to a file atomically by writing to a temporary file in the same
 * directory and then renaming it over the destination.
 */
export async function atomicWriteFile(filePath: string, content: string | Buffer): Promise<void> {
  const dir = path.dirname(filePath);
  const tempPath = path.join(dir, `.tmp-${randomUUID()}`);
  await fsp.writeFile(tempPath, content);
  await fsp.rename(tempPath, filePath);
}
