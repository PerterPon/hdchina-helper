



import * as config from './config';
import * as utils from './utils';
import * as transmission from './transmission';
import * as oss from './oss';
import * as message from './message';

import axios, { AxiosResponse } from 'axios';
import * as _ from 'lodash';
import { parse as parseUrl, UrlWithParsedQuery } from 'url';
import * as fs from 'fs';
import * as path from 'path';
import * as filesize from 'filesize';
import * as moment from 'moment';
import * as mysql from './mysql';
import * as puppeteer from './puppeteer';
import { mkdirpSync } from 'fs-extra';
import * as log from './log';

config.init();

let tempFolder: string = null;

export interface TItem {
  id: string;
  hash: string;
  free?: boolean;
  freeUntil?: Date;
  size: number;
  title: string;
  torrentUrl: string;
  transHash?: string;
}

async function start(): Promise<void> {
  try {
    await main();
  } catch(e) {
    log.log(e.message);
    log.log(e.stack);
    log.message('[ERROR!]');

    await message.sendMessage();
    await utils.sleep(2 * 1000);
    process.exit(1);
  }
}

async function main(): Promise<void> {
  await init();

  // 1. 
  const userInfo: puppeteer.TPageUserInfo = await puppeteer.getUserInfo();
  log.message(`share ratio: [${userInfo.shareRatio || ''}]`);
  log.message(`upload count: [${userInfo.uploadCount || ''}]`);
  log.message(` download count: [${userInfo.downloadCount || ''}]`);
  log.message(`matic point: [${userInfo.magicPoint || ''}]`)

  // 2.
  const freeItems: TItem[] = await puppeteer.filterFreeItem();
  log.log(`got free items: [${JSON.stringify(freeItems)}]`);
  // 3. 
  await mysql.storeItem(freeItems);
  // 5.
  const canDownloadItem: TItem[] = await mysql.getFreeItems();
  // 6. 
  await downloadItem(canDownloadItem);

  await message.sendMessage();
  await utils.sleep(5 * 1000);
  process.exit(0);
}

async function init(): Promise<void> {
  await config.init();
  await mysql.init();
  await transmission.init();
  await oss.init();
  await message.init();
  await puppeteer.init();
  await initTempFolder();
}

async function initTempFolder(): Promise<void> {
  const configInfo = config.getConfig();
  const { tempFolder: tempFolderConfig } = configInfo.hdchina;
  const fullTempFolder = path.join(__dirname, tempFolderConfig);
  mkdirpSync(fullTempFolder);
  tempFolder = fullTempFolder;
}

async function downloadItem(items: TItem[]): Promise<void> {
  log.log(`downloadItem: [${JSON.stringify(items)}]`);
  const configInfo = config.getConfig();
  const { downloadUrl, uid } = configInfo.hdchina;
  let downloadCount: number = 0;
  let existsTorrentCount: number = 0;
  let downloadErrorCount: number = 0;
  for (const item of items) {
    await utils.sleep(2 * 1000);
    const { hash, title, id, size, freeUntil } = item;
    const fileName: string = path.join(tempFolder, `${hash}.torrent`);
    if (false === fs.existsSync(fileName)) {
      try {
        // not exist, download
        const downloadLink = `${downloadUrl}?hash=${hash}&uid=${uid}`;
        const fileWriter = fs.createWriteStream(fileName);
        const res: AxiosResponse = await axios({
          url: downloadLink,
          method: 'get',
          responseType: 'stream',
          headers: {
            ...utils.downloadHeader
          }
        });
        await utils.writeFile(res.data, fileWriter);
        const leftTime: number = moment(freeUntil).unix() - moment().unix();
        log.log(`download torrent: [${fileName}], size: [${filesize(size)}], free time: [${moment(freeUntil).diff(moment(), 'hours')} H]`);
        downloadCount++;
      } catch (e) {
        downloadErrorCount++;
        console.error(`[ERROR]download file: [${fileName}] with error: [${e.message}]`);
      }
    } else {
      existsTorrentCount++;
    }
  }
  log.message(`download number: [${downloadCount}]`);
  log.message(`exists torrent count: [${existsTorrentCount}]`);
  log.message(`download error count: [${downloadErrorCount}]`);
}

