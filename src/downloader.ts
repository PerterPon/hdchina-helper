
import * as config from './config';
import * as utils from './utils';
import * as transmission from './transmission';
import * as oss from './oss';
import * as message from './message';

import axios, { AxiosResponse } from 'axios';
import * as _ from 'lodash';
import { parse as parseUrl, UrlWithParsedQuery } from 'url';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as filesize from 'filesize';
import * as moment from 'moment';
import * as mysql from './mysql';
import { mkdirpSync } from 'fs-extra';
import * as log from './log';
import { siteMap } from './sites/basic';
import * as puppeteer from './puppeteer';

import { TItem, TPTServer, TPTUserInfo } from './types';

let tempFolder: string = null;

export async function start(): Promise<void> {
  try {
    await start();
    await main();

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

export async function main(): Promise<void> {
  await initTempFolder();
  // 5.
  const canDownloadItem: TItem[] = await mysql.getFreeItems();

  // 6. 
  const downloadSuccessItem: TItem[] = await downloadItem(canDownloadItem);

  // 7.
  await uploadItem(downloadSuccessItem);

  let trans: { transId: string; hash: string; serverId: number }[] = [];
  try {
    trans = await addItemToTransmission(downloadSuccessItem);
  } catch (e) {
    log.log(e.message);
    log.log(e.stack);
  }

  // 8.
  await storeDownloadAction(trans, downloadSuccessItem);
  await utils.sleep(5 * 1000);
  // 9. 
  const downloadingItems: TItem[] = await getDownloadingItems();
  // 10. 
  const beyondFreeItems: TItem[] = await filterBeyondFreeItems(downloadingItems);
  // 11. 
  await removeItemFromTransmission(beyondFreeItems);
  // 12.
  await reduceLeftSpace();
  
  log.log(`all task done!!!!\n`);
}

async function init(): Promise<void> {
  await config.init();
  await mysql.init();
  const ptUserInfo: TPTUserInfo = await mysql.getUserInfo(config.nickname, config.site);
  await transmission.init(ptUserInfo.uid);
  await oss.init();
  await message.init();
  await initTempFolder();
}

async function initTempFolder(): Promise<void> {
  const configInfo = config.getConfig();
  const { tempFolder: tempFolderConfig } = configInfo;
  const fullTempFolder = path.join(__dirname, tempFolderConfig);
  mkdirpSync(fullTempFolder);
  tempFolder = fullTempFolder;
}

async function downloadItem(items: TItem[]): Promise<TItem[]> {
  log.log(`downloadItem: [${JSON.stringify(items)}]`);
  if (items.length > 5) {
    log.message(`target download items: [${items.length}], reduce to [${5}]`);
    items = items.splice(0, 5);
  }
  let downloadCount: number = 0;
  let existsTorrentCount: number = 0;
  let downloadErrorCount: number = 0;
  const downloadSuccessItems: TItem[] = [];
  const userInfo: TPTUserInfo = await mysql.getUserInfoByUid(config.uid);
  for (const item of items) {
    await utils.sleep(2 * 1000);
    const { site, title, id, size, freeUntil, torrentUrl } = item;
    const fileFullName: string = path.join(tempFolder, `${site}_${id}_${config.uid}.torrent`);
    const fileName: string = `${site}_${id}_${config.uid}.torrent`;
    if (true === fs.existsSync(fileFullName)) {
      existsTorrentCount++;
      downloadSuccessItems.push(item);
      continue;
    }

    try {
      // not exist, download
      const downloadLink = await siteMap[config.site].getDownloadUrl(item);
      log.log(`downloading file: [${downloadLink}]`);

      const fileWriter = fs.createWriteStream(fileFullName);
      // const downloadHeader = await siteMap[config.site].getDownloadHeader();
      const res: AxiosResponse = await axios.get(`${downloadLink}&passkey=${userInfo.passkey}`, {
        responseType: 'stream'
      });
      await utils.writeFile(res.data, fileWriter);
      const leftTime: number = moment(freeUntil).unix() - moment().unix();
      log.log(`download torrent: [${fileFullName}], size: [${filesize(size)}], free time: [${moment(freeUntil).diff(moment(), 'hours')} H]`);
      downloadCount++;
      downloadSuccessItems.push(item);
    } catch (e) {
      downloadErrorCount++;
      console.error(`[ERROR] download file: [${fileFullName}] with error: [${e.message}]`);
      fs.removeSync(fileFullName);
    }
  }
  if (0 < downloadCount) {
    log.message(`download number: [${downloadCount}]`);
  }
  log.log(`exists torrent count: [${existsTorrentCount}]`);
  log.log(`download error count: [${downloadErrorCount}]`);
  return downloadSuccessItems;
}

async function uploadItem(items: TItem[]): Promise<void> {
  log.log(`upload items: [${JSON.stringify(items)}]`);
  const configInfo = config.getConfig();
  for (const item of items) {
    const { site, id } = item;
    const fileName: string = `${config.uid}/${site}_${id}.torrent`;
    const filePath: string = path.join(tempFolder, `${site}_${id}_${config.uid}.torrent`);
    await oss.uploadTorrent(fileName, filePath);
  }
}

async function addItemToTransmission(items: TItem[]): Promise<{transId: string; hash: string; serverId: number; }[]> {
  log.log(`addItemToTransmission: [${JSON.stringify(items)}]`);
  const resInfo: {transId: string; hash: string; serverId: number}[] = [];
  const configInfo = config.getConfig();
  const { cdnHost } = configInfo.aliOss;
  let errorCount: number = 0;
  let successCount: number = 0;
  for (const item of items) {
    const { site, uid, id, title } = item;
    const torrentUrl: string = `http://${cdnHost}/hdchina/${uid}/${site}_${id}.torrent`;
    log.log(`add file to transmission: [${title}]`);
    const canAddServerIds: number[] = await transmission.canAddServers(config.vip);
    for (const canAddServerId of canAddServerIds) {
      const res = await doAddToTransmission(torrentUrl, canAddServerId);
      successCount++;
      resInfo.push(res);
    }
  }
  if (0 < successCount) {
    log.message(`add transmission success count: [${successCount}]`);
  }
  if (0 < errorCount) {
    log.message(`add transmission error count: [${errorCount}]`);
  }
  return resInfo;
}

async function doAddToTransmission(torrentUrl: string, serverId: number): Promise<{transId: string; hash: string; serverId: number}> {
  log.log(`doAddToTransmission torrent url: [${torrentUrl}], server id: [${serverId}]`);
  let res: {transId: string; hash: string; serverId: number; } = null;
  try {
    res = await transmission.addUrl(torrentUrl, serverId);
  } catch(e) {
    if ('invalid or corrupt torrent file' === e.message) {
      res = {
        transId: '0',
        hash: '0',
        serverId
      }
    } else {
      res = {
        transId: '-1',
        hash: '-1',
        serverId
      }
    }

    log.log(e.message);
    log.log(e.stack);
  }

  return res;
}

async function storeDownloadAction(transIds: {transId: string; hash: string; serverId: number}[], items: TItem[]): Promise<void> {
  log.log(`updateTransId2Item transIds: [${JSON.stringify(transIds)}], items: [${JSON.stringify(items)}]`);
  const configInfo = config.getConfig();

  for (let i = 0; i < transIds.length; i++) {
    const { transId, hash, serverId } = transIds[i];
    if ('-1' === transId) {
      continue;
    }
    const item: TItem = items[i];
    const { site, id, uid } = item;
    await mysql.updateTorrentHashBySiteAndId(site, id, hash);
    await mysql.storeDownloadAction(site, id, uid, transId, hash, serverId);
  }
}

async function getDownloadingItems(): Promise<TItem[]> {
  log.log(`getDownloadingItems`);
  const downloadingTransItems: transmission.TTransItem[] = await transmission.getDownloadingItems();
  const downloadingHash: string[] = [];


  for (const item of downloadingTransItems) {
    const { hash, downloadDir } = item;
    const server: TPTServer = transmission.serverConfigMap.get(item.serverId);
    if (undefined == server) {
      log.log(`trying to get downloading item with server id: [${item.serverId}], server not found`);
      continue;
    }
    const { fileDownloadPath } = server;
    // only the specific torrent we need to remove.
    if (downloadDir === fileDownloadPath) {
      downloadingHash.push(hash);
    }
  }
  const downloadingItems: TItem[] = await mysql.getItemByHash(downloadingHash);
  const downloadingItemNames: string[] = [];
  for (const downloadingItem of downloadingItems) {
    downloadingItemNames.push(downloadingItem.title);
  }
  log.log(`downloading item names: [${downloadingItemNames.join('\n')}]`);
  return downloadingItems;
}

async function filterBeyondFreeItems(items: TItem[]): Promise<TItem[]> {
  log.log(`filterBeyondFreeItems: [${JSON.stringify(items)}]`);
  const beyondFreeItems: TItem[] = [];
  for (const item of items) {
    const { freeUntil } = item;
    if (moment(freeUntil) < moment()) {
      beyondFreeItems.push(item);
    }
  }
  return beyondFreeItems;
}

async function removeItemFromTransmission(items: TItem[]): Promise<void> {
  log.log(`removeItemFromTransmission: [${JSON.stringify(items)}]`);
  const transIds: string[] = await mysql.getTransIdByItem(items);
  for (let i = 0; i < items.length; i++) {
    const transId: string = transIds[i];
    const item: TItem = items[i];
    log.log(`removing torrent: [${item.title}], server: [${item.serverId}]`);
    await transmission.removeItem(Number(transId), Number(item.serverId));
  }
  if (0 < items.length) {
    log.message(`remove torrent count: [${items.length}]`);
  }
}

async function reduceLeftSpace(): Promise<void> {
  log.log(`reduceLeftSpace`);
  const configInfo = config.getConfig();

  for (const server of transmission.servers) {
    const { id } = server;
    await doReduceLeftSpace(id);
  }

}

async function doReduceLeftSpace(serverId: number): Promise<void> {
  log.log(`doReduceLeftSpace server: [${serverId}]`);
  // let freeSpace: {serverId: number; size: number}[] = await transmission.freeSpace(serverId);
  const serverInfo: TPTServer = transmission.serverConfigMap.get(serverId);
  if (undefined === serverInfo) {
    throw new Error(`[Downloader] reduce left space with error: [${serverId}]`);
  }

  let [{ size: freeSpace }] = await transmission.freeSpace(serverId);
  const { minSpaceLeft, fileDownloadPath, minStayFileSize } = serverInfo;
  const allItems: transmission.TTransItem[] = await transmission.getAllItems();
  const datedItems: transmission.TTransItem[] = _.orderBy(allItems, ['activityDate']);
  let reducedTotal: number = 0;
  while (freeSpace < minSpaceLeft) {
    if (0 === datedItems.length) {
      break;
    }
    const item = datedItems.shift();
    const { id, status, downloadDir, size, name } = item;
    if (
      -1 === [transmission.status.DOWNLOAD, transmission.status.CHECK_WAIT, transmission.status.CHECK, transmission.status.DOWNLOAD_WAIT].indexOf(status) &&
      size > minStayFileSize &&
      downloadDir === fileDownloadPath
    ) {
      log.message(`remove item because of min left space: [${name}], size: [${filesize(size)}]`);
      reducedTotal += size;
      await transmission.removeItem(id, serverId);
      freeSpace += size;
    }
  }
  if (0 < reducedTotal) {
    log.message(`server id: [${serverId}] reduce space total: [${filesize(reducedTotal)}]`);
  }
}



// start();
