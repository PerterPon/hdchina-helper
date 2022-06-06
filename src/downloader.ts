
import * as config from './config';
import * as utils from './utils';
import * as transmission from './transmission';
import * as oss from './oss';
import * as message from './message';

import axios, { AxiosResponse } from 'axios';
import * as parseTorrent from 'parse-torrent';
import * as _ from 'lodash';
import { parse as parseUrl, UrlWithParsedQuery } from 'url';
import * as fs from 'fs-extra';
import * as path from 'path';
import * as filesize from 'filesize';
import * as urlLib from 'url';
import * as moment from 'moment';
import * as mysql from './mysql';
import { mkdirpSync } from 'fs-extra';
import * as log from './log';
import { siteMap, getCurrentSite } from './sites/basic';
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
  const canDownloadItem: TItem[] = await mysql.getFreeItems(config.uid, config.site);

  // 6. 
  const downloadSuccessItem: TItem[] = await downloadItem(canDownloadItem as any);

  // 7.
  await uploadItem(downloadSuccessItem);

  let trans = {};
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
  const ptUserInfo: TPTUserInfo = await mysql.getUserInfoByQuery({
    nickname: config.nickname,
    site: config.site
  });
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
  if (items.length > 10) {
    log.message(`target download items: [${items.length}], reduce to [${5}]`);
    items = items.splice(0, 5);
  }
  let downloadCount: number = 0;
  let existsTorrentCount: number = 0;
  let downloadErrorCount: number = 0;
  const downloadSuccessItems: TItem[] = [];
  const userInfo: TPTUserInfo = config.userInfo;
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
      const downloadLink = await getCurrentSite().getDownloadUrl(item);
      log.log(`downloading file: [${downloadLink}]`);

      const fileWriter = fs.createWriteStream(fileFullName);
      // const downloadHeader = await siteMap[config.site].getDownloadHeader();
      const res: AxiosResponse = await axios.get(`${downloadLink}&passkey=${userInfo.passkey}`, {
        responseType: 'stream'
      });
      await utils.writeFile(res.data, fileWriter);
      const leftTime: number = moment(freeUntil).unix() - moment().unix();
      log.message(`download torrent: [${title}], size: [${filesize(size)}], free time: [${moment(freeUntil).diff(moment(), 'hours')} H]`);
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

async function addProxyToTorrentFile(torrentFile: Buffer, proxyAddr: string): Promise<Buffer> {
  log.log(`addProxyToTorrentFile torrentFile:[${torrentFile.length}], proxyAddr: [${proxyAddr}]`);
  const parsedTorrent: parseTorrent.Instance = parseTorrent(torrentFile) as parseTorrent.Instance;
  const announceUrl = parsedTorrent.announce[0];
  const proxyItem = urlLib.parse(proxyAddr, true);
  const announceUrlItem = urlLib.parse(announceUrl, true);
  announceUrlItem.query.__uid = config.uid;
  const proxyUrlItem = {
    hostname: proxyItem.hostname,
    port: proxyItem.port,
    protocol: proxyItem.protocol,
    query: announceUrlItem.query,
    pathname: announceUrlItem.pathname
  };
  const proxyUrl: string = urlLib.format(proxyUrlItem);
  parsedTorrent.announce = [ proxyUrl ];
  const proxyContent: Buffer = parseTorrent.toTorrentFile(parsedTorrent);
  return proxyContent;
}

async function uploadItem(items: TItem[]): Promise<void> {
  log.log(`upload items: [${JSON.stringify(items)}]`);
  for (const item of items) {
    const { site, id } = item;
    const fileName: string = `${config.uid}/${site}_${id}.torrent`;
    const filePath: string = path.join(tempFolder, `${site}_${id}_${config.uid}.torrent`);
    await oss.uploadTorrent(fileName, filePath);
  }
}

async function addItemToTransmission(items: TItem[]): Promise<{[key: string]: {transId: string; hash: string; serverId: number; }}> {
  log.log(`addItemToTransmission: [${JSON.stringify(items)}]`);
  const resInfo = {};
  const configInfo = config.getConfig();
  const { cdnHost } = configInfo.aliOss;
  let errorCount: number = 0;
  let successCount: number = 0;
  const userInfo: TPTUserInfo = config.userInfo;
  let canAddServerIds: number[] = userInfo.serverIds;
  canAddServerIds = _.shuffle(canAddServerIds);
  const serverAddNumMap: Map<number, number> = new Map();
  for (const item of items) {
    try {
      const { site, uid, id, title } = item;
      // const torrentUrl: string = `http://${cdnHost}/hdchina/${uid}/${site}_${id}.torrent`;
      const curServerId: number = canAddServerIds.shift();
      log.log(`add file to transmission: [${title}], server id: [${curServerId}]`);
      const res = await doAddToTransmission(curServerId, id);
      successCount++;
      canAddServerIds.push(curServerId);
      let addedNumber: number = serverAddNumMap.get(curServerId);
      if (undefined === addedNumber) {
        addedNumber = 0;
      }
      addedNumber++;
      serverAddNumMap.set(curServerId, addedNumber);
      resInfo[id] = res;
    } catch (e) {
      log.log(e.message, e.stack);
    }
  }
  if (0 < successCount) {
    log.message(`add transmission success count: [${successCount}]`);
    for (const serverId of canAddServerIds) {
      log.message(`server: [${serverId}] add success count: [${serverAddNumMap.get(serverId) || 0}]`);
    }
  }
  if (0 < errorCount) {
    log.message(`add transmission error count: [${errorCount}]`);
  }
  return resInfo;
}

async function doAddToTransmission(serverId: number, siteId: string): Promise<{transId: string; hash: string; serverId: number}> {
  log.log(`doAddToTransmission server id: [${serverId}], siteId: [${siteId}]`);
  let res: {transId: string; hash: string; serverId: number; } = null;
  const userInfo: TPTUserInfo = config.userInfo;
  const fileFullName: string = path.join(tempFolder, `${config.site}_${siteId}_${config.uid}.torrent`);
  let fileContent: Buffer = fs.readFileSync(fileFullName);
  if (true === userInfo.proxy) {
    fileContent = await addProxyToTorrentFile(fileContent, userInfo.proxyAddr);
    fs.writeFileSync(fileFullName, fileContent);
  }
  try {
    const torrentBase64: string = fileContent.toString('base64');
    res = await transmission.addBase64(torrentBase64, serverId, siteId);
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

async function storeDownloadAction(transIds: {[key: string]: {transId: string; hash: string; serverId: number}}, items: TItem[]): Promise<void> {
  log.log(`updateTransId2Item transIds: [${JSON.stringify(transIds)}], items: [${JSON.stringify(items)}]`);
  const configInfo = config.getConfig();

  for (const item of items) {
    const { id } = item;
    if (undefined === transIds[id]) {
      continue;
    }
    const { transId, hash, serverId } = transIds[id];
    if ('-1' === transId) {
      continue;
    }
    const { site, uid } = item;
    await mysql.updateTorrentHashBySiteAndId(config.uid, site, id, hash);
    await mysql.storeDownloadAction(site, id, uid, transId, hash, serverId);
  }

}

async function getDownloadingItems(): Promise<TItem[]> {
  log.log(`getDownloadingItems`);

  const downloadingItems: TItem[] = [];
  for (const server of transmission.servers) {
    const { id } = server;
    const serverItems: transmission.TTransItem[] = await transmission.getAllItems(id);
    const siteIds: string[] = [];
    for (const item of serverItems) {
      const { siteId, isFinished } = item;
      if (true === isFinished) {
        siteIds.push(siteId);
      }
    }
    const siteItems: TItem[] = await mysql.getItemBySiteIds(config.uid, config.site, siteIds);
    downloadingItems.push(...siteItems);
    log.message(`server: [${id}] downloading count: [${siteItems.length}]`);
  }
  return downloadingItems;
}

async function filterBeyondFreeItems(items: TItem[]): Promise<TItem[]> {
  log.log(`filterBeyondFreeItems: [${JSON.stringify(items)}]`);
  const beyondFreeItems: TItem[] = [];
  for (const item of items) {
    const { freeUntil, free } = item;
    if (false === free || null === freeUntil || moment(freeUntil) < moment()) {
      beyondFreeItems.push(item);
    }
  }
  return beyondFreeItems;
}

async function removeItemFromTransmission(items: TItem[]): Promise<void> {
  log.log(`removeItemFromTransmission: [${JSON.stringify(items)}]`);
  const transIds: number[] = await mysql.getTransIdByItem(config.uid, items);
  for (let i = 0; i < items.length; i++) {
    const transId: number = transIds[i];
    const item: TItem = items[i];
    log.log(`removing torrent: [${item.title}], server: [${item.serverId}] because of out of date`);
    await transmission.removeItem(Number(transId), item.id, Number(item.serverId));
    await mysql.deleteDownloaderItem(config.uid, config.site, item.serverId, transId);
  }
  if (0 < items.length) {
    log.message(`remove torrent count: [${items.length}] because of out of date`);
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
  // const activeIds: number[] = await mysql.getUserActiveTransId(config.uid, config.site, serverId);
  const allItems: transmission.TTransItem[] = await transmission.getAllItems(serverId);
  log.log(`server: [${serverId}] downloading item length: [${allItems.length}]`);
  const datedItems: transmission.TTransItem[] = _.orderBy(allItems, ['activityDate']);
  let reducedTotal: number = 0;
  while (freeSpace < minSpaceLeft) {
    if (0 === datedItems.length) {
      break;
    }
    const item = datedItems.shift();
    const { id, status, downloadDir, size, name, serverId: itemServerId } = item;
    if (
      -1 === [transmission.status.DOWNLOAD, transmission.status.CHECK_WAIT, transmission.status.CHECK, transmission.status.DOWNLOAD_WAIT].indexOf(status) &&
      0 === downloadDir.indexOf(fileDownloadPath)
    ) {
      log.message(`remove item because of min left space: [${name}], size: [${filesize(size)}] trans id: [${id}] server id: [${itemServerId}]`);
      reducedTotal += size;
      const { uid, site } = config.userInfo;
      try {
        const itemInfo: TItem = await mysql.getItemByTransIdAndServerId(id, itemServerId, uid, site);
        await transmission.removeItem(id, itemInfo.id, itemServerId);
        await mysql.deleteDownloaderItem(config.uid, config.site, itemServerId, id);
        freeSpace += size;
      } catch (e) {
        log.log(e, e.message);
      }
    }
  }
  if (0 < reducedTotal) {
    log.message(`server id: [${serverId}] reduce space total: [${filesize(reducedTotal)}]`);
    let [{ size: freeSpace }] = await transmission.freeSpace(serverId);
    log.message(`server id: [${serverId}] now space: [${filesize(freeSpace)}]`)
  }
}



// start();
