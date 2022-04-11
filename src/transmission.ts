
const Tranmission = require('transmission');
import { promisify } from 'util';
import * as config from './config';
import { displayTime } from './utils';

export interface TTransItem {
  id: number;
  downloadDir: string;
  name: string;
  hash: string;
  status: number;
}

let transmission: any = null;

export async function init(): Promise<void> {
  const configInfo = config.getConfig();
  const { host, port, username, password, ssl } = configInfo.hdchina.transmission;
  transmission = new Tranmission({
    host, port, username, password, ssl
  });
  transmission.active = promisify(transmission.active);
  transmission.get = promisify(transmission.get);
  transmission.addUrl = promisify(transmission.addUrl);
  transmission.remove = promisify(transmission.remove);
}

export async function getDownloadingItems(): Promise<TTransItem[]> {
  console.log(`[${displayTime()}] [Transmission] get download items`);
  const data = await transmission.active();
  const downloadingItems: TTransItem[] = [];
  for (const item of data.torrents) {
    if( transmission.status.DOWNLOAD === item.status) {
      const { status, id, name, downloadDir, hashString } = item;
      downloadingItems.push({
        id, name, downloadDir, status,
        hash: hashString
      });
    }
  }
  return downloadingItems;
}

export async function removeItem(id: string): Promise<void> {
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
