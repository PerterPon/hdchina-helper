
import * as moment from 'moment';

export function sleep(time: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, time);
  });
}

export function displayTime(): string {
  return moment().format('YYYY-MM-DD HH:mm:SS');
}
