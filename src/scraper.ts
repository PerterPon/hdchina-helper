
import * as config from './config';
import * as utils from './utils';
import * as transmission from './transmission';
import * as oss from './oss';
import * as message from './message';
import * as mysql from './mysql';
import * as puppeteer from './puppeteer-basic';
import * as log from './log';

import * as _ from 'lodash';
import * as path from 'path';
import * as filesize from 'filesize';
import { mkdirpSync } from 'fs-extra';
import { Command } from 'commander';
import * as moment from 'moment-timezone';

import { TPageUserInfo } from './sites/basic';

import { TItem, TPTServer, TPTUserInfo, TSiteData } from './types';
import { createClientByServer, IClient } from './clients/basic';

import { main as startDownloader } from './downloader';

const program = new Command();

program
  .option('-s, --site <char>', 'separator character')
  .option('-n, --nickname <char>', 'separator character');

program.parse(process.argv);
config.setSite(program.site);
config.setNick(program.nickname);

config.init();

let tempFolder: string = null;

async function start(): Promise<void> {
  const version = utils.getVersion();
  try {
    const startDate: Date = new Date();
    await init();
    log.message(`[${utils.displayTime()}] version: [${version}] nickname: [${config.nickname}] site: [${config.site}], uid: [${config.uid}]`);

    await storeSiteData();
    const userInfo: TPTUserInfo = config.userInfo;
    if (false === userInfo.siteDataOnly) {
      await main();
      await startDownloader();
    }

    const endDate: Date = new Date();
    const diffTime: number = endDate.getTime() - startDate.getTime();
    try {
      await tryAddTags2QB();
    } catch (e) {
      log.log(e);
    }
    log.message(`current task take time: [${(diffTime / 1000 / 60).toFixed(2)}m]`);
    await message.sendMessage();
    await utils.sleep(5 * 1000);
    process.exit(0);
  } catch(e) {
    log.log(e.message);
    log.log(e.stack);
    log.message('[ERROR!]');

    await message.sendErrorMessage();
    await utils.sleep(2 * 1000);
    process.exit(1);
  }
}

async function storeSiteData(): Promise<void> {
  log.log('storeSiteData');
  const configInfo = config.getConfig();
  const userInfo: TPageUserInfo = await puppeteer.getUserInfo(configInfo.torrentPage[0]);
  const { shareRatio, downloadCount, uploadCount, magicPoint } = userInfo;

  const latestSiteData: TSiteData = await mysql.getLatestSiteData(config.uid, config.site) || {} as any;
  const firstSiteData: TSiteData = await mysql.getFirstSiteData(config.uid, config.site) || {} as any;
  const increaseUpload: string = (Number(uploadCount) - latestSiteData.uploadCount || 0).toFixed(3);
  const increaseDownload: string = (Number(downloadCount) - latestSiteData.downloadCount || 0).toFixed(3);
  const userInfoData: TPTUserInfo = config.userInfo;
  log.message(`increase up: [${increaseUpload}], down: [${increaseDownload}]`);
  log.message(`total up: [${(Number(uploadCount) - firstSiteData.uploadCount).toFixed(3)}], down: [${(Number(downloadCount) - firstSiteData.downloadCount).toFixed(3)}], all: [${userInfoData.uploadCount}]`);
  log.message(`share ratio: [${shareRatio || ''}]`);
  log.message(`up count: [${uploadCount || ''}]`);
  log.message(`down count: [${downloadCount || ''}]`);
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
  const { torrentPage, needExtraFreeCheck, downloadingItemStatus } = configInfo;
  for (const pageUrl of torrentPage) {
    try {
      let freeItems: TItem[] = [];
      if (true === config.vip) {
        freeItems = await puppeteer.filterVIPItem(pageUrl);
      } else {
        freeItems = await puppeteer.filterFreeItem(pageUrl);
      }
      // if (true === needExtraFreeCheck) {
      //   await checkItemFree(freeItems);
      // }
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
  const ptUserInfo: TPTUserInfo = await mysql.getUserInfoByQuery({
    nickname: config.nickname,
    site: config.site
  });
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

async function tryAddTags2QB(): Promise<void> {
  log.log(`try add tags to qb`);
  const servers: TPTServer[] = transmission.servers;
  for(const server of servers) {
    const client: IClient = await createClientByServer(server);
    const torrents = await client.getTorrents();
    for (const torrent of torrents) {
      const { save_path, hash, tags } = torrent;
      const items = save_path.split('\/');
      items.pop();
      const siteId = items.pop();
      const uid = items.pop();
      const site = items.pop();
      const tag = `${site}/${uid}`;
      if (-1 === tags.indexOf(tag)) {
        await client.addTags(hash, `${site}/${uid}`);
      }
    }
  }
}

start();

setTimeout(async () => {
  log.message(`[${utils.displayTime()}] timeout!!!`);
  await message.sendMessage()
  process.exit(1);
}, 600 * 1000);
