
const Transmission = require('transmission');
import * as _ from 'lodash';
import { promisify } from 'util';
import * as config from './config';
import { displayTime } from './utils';

export interface TTransItem {
  id: number;
  downloadDir: string;
  name: string;
  hash: string;
  status: number;
  size: number;
  activityDate: Date;
  isFinished: boolean;
}

let transmission: any = null;

export async function init(): Promise<void> {
  const configInfo = config.getConfig();
  const { host, port, username, password, ssl } = configInfo.hdchina.transmission;
  transmission = new Transmission({
    host, port, username, password, ssl
  });
  Object.assign(status, transmission.status);
  for (const fnName in transmission) {
    const fn = transmission[fnName];
    if (true === _.isFunction(fn)) {
      transmission[fnName] = promisify(fn);
    }
  }
}

export async function getDownloadingItems(): Promise<TTransItem[]> {
  console.log(`[${displayTime()}] [Transmission] get download items`);
  const data = await transmission.active();
  const downloadingItems: TTransItem[] = [];
  for (const item of data.torrents) {
    if( transmission.status.DOWNLOAD === item.status) {
      const { status, id, name, downloadDir, hashString, sizeWhenDone: size, activityDate, isFinished } = item;
      downloadingItems.push({
        id, name, downloadDir, status, size, activityDate, isFinished,
        hash: hashString
      });
    }
  }
  return downloadingItems;
}

export async function getAllItems(): Promise<TTransItem[]> {
  console.log(`[${displayTime()}] [Transmission] getAllItems`);
  const data = await transmission.get();
  const downloadingItems: TTransItem[] = [];
  for (const item of data.torrents) {
    const { status, id, name, downloadDir, hashString, sizeWhenDone: size, activityDate, isFinished } = item;
    downloadingItems.push({
      id, name, downloadDir, status, size, activityDate, isFinished,
      hash: hashString
    });
  }
  return downloadingItems;
}

export async function removeItem(id: number): Promise<void> {
  console.log(`[${displayTime()}] [Transmission] remove item: [${id}]`);
  const result = await transmission.remove(id, true);
  console.log(`[${displayTime()}] [Transmission] remove item: [${id}] with result: [${JSON.stringify(result)}]`);
}

export async function addUrl(url: string): Promise<{transId: string; hash: string;}> {
  console.log(`[${displayTime()}] [Transmission] add url: [${url}]`);
  const configInfo = config.getConfig();
  const { fileDownloadPath } = configInfo.hdchina.transmission;
  const res = await transmission.addUrl(url, {
    'download-dir':  fileDownloadPath
  });
  console.log(`[${displayTime()}] [Transmission] add url with result: [${JSON.stringify(res)}]`);
  const { id, hashString } = res;
  return {
    transId: id,
    hash: hashString
  };
}

export async function freeSpace(): Promise<number> {
  const res = await transmission.freeSpace('/volume1');
  return res['size-bytes'];
}

export const status: any = {};