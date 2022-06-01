
import * as config from './config';
import * as utils from './utils';
import * as transmission from './transmission';
import * as oss from './oss';
import * as message from './message';
import * as mysql from './mysql';
import * as puppeteer from './puppe-lite';
// import * as puppeteer from './puppeteer';
import * as log from './log';

import * as _ from 'lodash';
import * as path from 'path';
import * as filesize from 'filesize';
import { mkdirpSync } from 'fs-extra';
import { Command } from 'commander';
import * as moment from 'moment-timezone';

import { TPageUserInfo } from './sites/basic';

import { TItem, TPTUserInfo, TSiteData } from './types';

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
    const startDate: Date = new Date();
    await init();

    await storeSiteData();
    const userInfo: TPTUserInfo = config.userInfo;
    if (false === userInfo.siteDataOnly) {
      await main();
      await startDownloader();
    }

    const endDate: Date = new Date();
    const diffTime: number = endDate.getTime() - startDate.getTime();
    log.message(`current task take time: [${(diffTime / 1000 / 60).toFixed(2)}m]`);
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

async function storeSiteData(): Promise<void> {
  log.log('storeSiteData');
  const configInfo = config.getConfig();
  const userInfo: TPageUserInfo = await puppeteer.getUserInfo(configInfo.torrentPage[0]);
  const { shareRatio, downloadCount, uploadCount, magicPoint } = userInfo;

  const latestSiteData: TSiteData = await mysql.getLatestSiteData(config.uid, config.site);
  const increaseUpload: string = (Number(uploadCount) - latestSiteData.uploadCount).toFixed(3);
  const increaseDownload: string = (Number(downloadCount) - latestSiteData.downloadCount).toFixed(3);
  log.message(`increase upload: [${increaseUpload}], download: [${increaseDownload}]`);
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
  await mysql.storeSiteInfo(config.uid, config.site, {
    shareRatio: Number(shareRatio),
    downloadCount: Number(downloadCount),
    uploadCount: Number(uploadCount),
    magicPoint: Number(magicPoint),
    uploadSpeed: Number(totalUploadSpeed),
    downloadSpeed: Number(totalDownloadSpeed),
  });
}

async function main(): Promise<void> {
  log.log(`main`);
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
      await mysql.storeItem(config.uid, config.site, freeItems);
    } catch (e) {
      log.log(`[WARN] ${e} ${e.stack}`);
    }
  }
}

async function init(): Promise<void> {
  log.log(`init`);
  await config.init();
  await initTempFolder();
  await mysql.init();
  const ptUserInfo: TPTUserInfo = await mysql.getUserInfo(config.nickname, config.site);
  config.setUid(ptUserInfo.uid);
  config.setVip(ptUserInfo.vip);
  config.setUserInfo(ptUserInfo);
  await transmission.init(ptUserInfo.uid);
  await oss.init();
  await message.init();
  await puppeteer.init();
}

async function initTempFolder(): Promise<void> {
  log.log(`initTempFolder`);
  const configInfo = config.getConfig();
  const { tempFolder: tempFolderConfig } = configInfo;
  const fullTempFolder = path.join(__dirname, tempFolderConfig);
  mkdirpSync(fullTempFolder);
  tempFolder = fullTempFolder;
  config.setTempFolder(tempFolder);
}

start();

setTimeout(async () => {
  log.message(`[${utils.displayTime()}] timeout!!!`);
  await message.sendMessage()
  process.exit(1);
}, 600 * 1000);
