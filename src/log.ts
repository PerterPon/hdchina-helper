
import * as util from './utils';
import * as config from './config';

export let logs: string[] = [];
export let messages: string[] = [];

export function log(...contents: string[]): void {
  contents[0] = `[${util.displayTime()}] ${contents[0]}`;
  logs.push(...contents);
  console.log(...contents);
  logs = checkLogArr(logs);
}

export function message(...contents: string[]): void {
  messages.push(...contents);
  logs.push(...contents);
  console.log(...contents);
  messages = checkLogArr(messages);
  logs = checkLogArr(logs);
}

function checkLogArr(arr) {
  if (arr.length > 50000) {
    arr = arr.splice(arr.length - 50000);
  }
  return arr;
}

