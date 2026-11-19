/** Plain-text output for CLI scripts (logs from long-running processes go through pino). */
export function print(line = ''): void {
  process.stdout.write(`${line}\n`);
}

export function printError(line: string): void {
  process.stderr.write(`${line}\n`);
}
