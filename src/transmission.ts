
const Transmission = require('transmission');
import * as _ from 'lodash';
import { promisify } from 'util';
import * as config from './config';
import * as log from './log';
import * as filesize from 'filesize';

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
  const { host, port, username, password, ssl } = configInfo.transmission;
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
  log.log(`[Transmission] get download items`);
  const data = await transmission.get();
  const downloadingItems: TTransItem[] = [];
  const configInfo = config.getConfig();
  for (const item of data.torrents) {
    const { status, id, name, downloadDir, hashString, sizeWhenDone: size, activityDate, isFinished } = item;
    if( -1 < [
        transmission.status.DOWNLOAD, 
        transmission.status.DOWNLOAD_WAIT, 
        transmission.status.CHECK, 
        transmission.status.CHECK_WAIT, 
        transmission.status.STOPPED
        ].indexOf(status)
    ){
      downloadingItems.push({
        id, name, downloadDir, status, size, activityDate, isFinished,
        hash: hashString
      });
    }
  }
  return downloadingItems;
}

export async function getAllItems(): Promise<TTransItem[]> {
  log.log(`[Transmission] getAllItems`);
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
  log.log(`[Transmission] remove item: [${id}]`);
  const result = await transmission.remove(id, true);
  log.log(`[Transmission] remove item: [${id}] with result: [${JSON.stringify(result)}]`);
}

export async function addUrl(url: string): Promise<{transId: string; hash: string;}> {
  log.log(`[Transmission] add url: [${url}]`);
  const configInfo = config.getConfig();
  const { fileDownloadPath } = configInfo.transmission;
  const res = await transmission.addUrl(url, {
    'download-dir':  fileDownloadPath
  });
  log.log(`[Transmission] add url with result: [${JSON.stringify(res)}]`);
  const { id, hashString } = res;
  return {
    transId: id,
    hash: hashString
  };
}

export async function freeSpace(): Promise<number> {
  const configInfo = config.getConfig();
  const { fileDownloadPath } = configInfo.transmission;
  const res = await transmission.freeSpace(fileDownloadPath);
  log.message(`left space total: [${filesize(res['size-bytes'])}]`);
  log.log(`[Transmission] free space: [${fileDownloadPath}], total: [${filesize(res['size-bytes'])}]`);
  return res['size-bytes'];
}

export const status: any = {};
