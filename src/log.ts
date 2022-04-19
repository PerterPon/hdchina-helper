
import * as util from './utils';

export const logs: string[] = [];
export const messages: string[] = [];

export function log(...contents: string[]): void {
  contents[0] = `[${util.displayTime()}] ${contents[0]}`;
  logs.push(...contents);
  console.log(...contents);
}

export function message(...contents: string[]): void {
  messages.push(...contents);
  logs.push(...contents);
  console.log(...contents);
}
