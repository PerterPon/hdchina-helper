
export const logs: string[] = [];
export const messages: string[] = [];

export function log(...messages: string[]): void {
  logs.push(...messages);
}

export function message(...messages: string[]): void {
  messages.push(...messages);
  logs.push(...messages);
}
