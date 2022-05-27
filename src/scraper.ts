
import * as config from './config';
import * as utils from './utils';
import * as transmission from './transmission';
import * as oss from './oss';
import * as message from './message';
import * as mysql from './mysql';
import * as puppeteer from './puppeteer';
import * as log from './log';

import * as _ from 'lodash';
import * as path from 'path';
import * as filesize from 'filesize';
import { mkdirpSync } from 'fs-extra';
import { Command } from 'commander';
import * as moment from 'moment-timezone';

import { TPageUserInfo } from './sites/basic';

import { TItem, TPTUserInfo } from './types';

import { main as startDownloader } from './downloader';

const program = new Command();

program
  .option('-s, --site <char>', 'separator character')
  .option('-n, --nickname <char>', 'separator character');

program.parse(process.argv);
config.setSite(program.site);
config.setNick(program.nickname);

log.message(`[${utils.displayTime()}] nickname: [${config.nickname}] site: [${config.site}], uid: [${config.uid}]`);

config.init();

let tempFolder: string = null;

async function start(): Promise<void> {
  try {
    await init();
    await main();
    await startDownloader();

    await puppeteer.close();
    await message.sendMessage();
    await utils.sleep(5 * 1000);
    process.exit(0);
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
  // 1. 
  const userInfo: TPageUserInfo = await puppeteer.getUserInfo();
  const { shareRatio, downloadCount, uploadCount, magicPoint } = userInfo;
  log.message(`share ratio: [${shareRatio || ''}]`);
  log.message(`upload count: [${uploadCount || ''}]`);
  log.message(`download count: [${downloadCount || ''}]`);
  log.message(`magic point: [${magicPoint || ''}]`)

  const statesRes = await transmission.sessionStates();
  let totalUploadSpeed: number = 0;
  let totalDownloadSpeed: number = 0;
  for (const state of statesRes) {
    const { serverId, uploadSpeed, downloadSpeed } = state;
    totalUploadSpeed += uploadSpeed || 0;
    totalDownloadSpeed += downloadSpeed || 0;
    log.message(`[${serverId}] [${filesize(uploadSpeed)}/s] [${filesize(downloadSpeed)}/s]`);
  }

  // 2.
  await mysql.storeSiteInfo(Number(shareRatio), Number(downloadCount), Number(uploadCount), Number(magicPoint), Number(totalUploadSpeed), Number(totalDownloadSpeed));

  // 3.
  const configInfo = config.getConfig();
  const { torrentPage } = configInfo;
  for (const pageUrl of torrentPage) {
    try {
      let freeItems: TItem[] = [];
      if (true === config.vip) {
        freeItems = await puppeteer.filterVIPItem(pageUrl);
      } else {
        freeItems = await puppeteer.filterFreeItem(pageUrl);
      }
      log.log(`got free items: [${JSON.stringify(freeItems)}]`);
      log.message(`free item count: [${freeItems.length}]`);
      // 4. 
      await mysql.storeItem(freeItems);
    } catch (e) {
      log.log(`[WARN] ${e} ${e.stack}`);
    }
  }
}

async function init(): Promise<void> {
  await config.init();
  await initTempFolder();
  await mysql.init();
  const ptUserInfo: TPTUserInfo = await mysql.getUserInfo(config.nickname, config.site);
  config.setUid(ptUserInfo.uid);
  config.setVip(ptUserInfo.vip);
  await transmission.init(ptUserInfo.uid);
  await oss.init();
  await message.init();
  await puppeteer.init();
}

async function initTempFolder(): Promise<void> {
  const configInfo = config.getConfig();
  const { tempFolder: tempFolderConfig } = configInfo;
  const fullTempFolder = path.join(__dirname, tempFolderConfig);
  mkdirpSync(fullTempFolder);
  tempFolder = fullTempFolder;
  config.setTempFolder(tempFolder);
}

start();
