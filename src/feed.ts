
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
import axios, { AxiosResponse } from 'axios';

import { TPageUserInfo } from './sites/basic';

import { TItem, TPTServer, TPTUserInfo, TSiteData } from './types';
import { createClientByServer, IClient } from './clients/basic';

import { tryAddFreeItems } from './downloader';
import { getCurrentSite } from './sites/basic';

const DETECT_COUNT = 2;

const program = new Command();

program
  .option('-s, --site <char>', 'separator character')
  .option('-n, --nickname <char>', 'separator character');

program.parse(process.argv);
config.setSite(program.site);
config.setNick(program.nickname);

config.init();

let tempFolder: string = null;

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

async function start(): Promise<void> {
  await init();
  const version = utils.getVersion();
  log.log(`start feeding! version: [${version}]`);

  startFeedTask();
  startSiteInfoTask();
  startRssAssist();
}

async function startFeedTask(): Promise<void> {
  log.log(`startFeedTask`);
  const puppeSite = getCurrentSite();
  const downloadHeaders = puppeSite.getDownloadHeader();
  const { uid, site } = config;
  let i = 0;
  while (true) {
    try {
      i++;
      log.log(`start new cycle [${i}]!!`);
      const latestInfo: TItem[] = await mysql.getLatestSiteInfo(uid, site, 1);
      const baseSiteId: number = Number(_.get(latestInfo, '[0].id'));
      if (true === _.isNaN(baseSiteId)) {
        continue;
      }
  
      const tasks = [];
      for (let i = 1; i <= DETECT_COUNT; i++) {
        const siteId: number = baseSiteId + i;
        const task = tryGetLatestTorrent(siteId, downloadHeaders);
        tasks.push(task);
      }

      await Promise.all(tasks);

      const addSuccessItems: TItem[] = await tryAddFreeItems(0);
      if (0 < addSuccessItems.length) {
        await tryAddTags2QB();
      }
  
      log.log(`cycle: [${i}] add success count: [${addSuccessItems.length}] waiting for next cycle! latest site id: [${baseSiteId}]`);
      log.log('----------------------------------------------------------');
      log.log('----------------------------------------------------------');
    } catch (e) {
      log.log(e);
    }

    await utils.sleep(30 * 1000);
  }
}

async function startSiteInfoTask(): Promise<void> {
  log.log(`startSiteInfoTask`);
  while(true) {
    await utils.sleep(10 * 60 * 1000);
    try {
      const start: number = Date.now();
      await storeSiteData();
      const end: number = Date.now();
      log.log(`complete store site info! take time: [${end - start}]ms, wait for another cycle!`);
      log.log('=================================================');
      log.log('=================================================');
    } catch (e) {
      log.log(e);
    }
  }
}

async function startRssAssist(): Promise<void> {
  log.log(`startRssAssist`);
  const configInfo = config.getConfig();
  const { torrentPage, needExtraFreeCheck, downloadingItemStatus } = configInfo;
  while (true) {
    await utils.sleep(15 * 60 * 1000);
    try {
      const freeItems: TItem[] = await puppeteer.filterVIPItem(torrentPage[0]);
      log.log(`got free items: [${JSON.stringify(freeItems)}]`);
      log.message(`free item count: [${freeItems.length}]`);
      // 4. 
      await mysql.storeItem(config.uid, config.site, freeItems); 
      log.log(`complete rss assists, wait for another cycle!!`);
      log.log(`||||||||||||||||||||||||||||||||||||||||||||||`);
      log.log(`||||||||||||||||||||||||||||||||||||||||||||||`);
    } catch (e) {
      log.log(e);
    }
  }

}

async function tryGetLatestTorrent(siteId: number, headers: any): Promise<void> {
  log.log(`tryGetLatestTorrent, site id: [${siteId}]`);
  const site = getCurrentSite();
  const downloadLink = site.assembleLink(siteId, config.userInfo.passkey);

  try {
    const res = await axios.get(downloadLink, {
      responseType: 'stream',
      headers
    });
    if (200 === res.status) {
      log.log(`got new site id, site id: [${siteId}]!!!`);
      await mysql.storeItem(config.uid, config.site, [{ 
        id: siteId,
        freeUntil: new Date('2024-01-01'), 
        size: 0,
        title: 'torrent from feed. :)',
        torrentUrl: downloadLink, 
        free: true,
        transHash: '',
        publishDate: new Date(),
        feed: true
      }] as any);
    }
  } catch (e) {
    log.log(`tryGetLatestTorrent with status: [${e.response.status}]`);
  }
}

async function storeSiteData(): Promise<void> {
  log.log('storeSiteData');
  const configInfo = config.getConfig();
  const userInfo: TPageUserInfo = await puppeteer.getUserInfo(configInfo.indexPage);
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
      let siteId = items.pop();
      if (1 >= siteId.length) {
        siteId = items.pop();
      }
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
