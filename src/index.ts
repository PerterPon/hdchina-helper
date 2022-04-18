
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

  const freeItems: TItem[] = await puppeteer.filterFreeItem();
  log.log(`[${utils.displayTime()}] got free items: [${JSON.stringify(freeItems)}]`);
  log.log(`[${utils.displayTime()}] free items: [${JSON.stringify(freeItems)}]`);
  await mysql.storeItem(freeItems);
  // 5.
  const canDownloadItem: TItem[] = await mysql.getFreeItems();
  // 6. 
  await downloadItem(canDownloadItem);
  // 7.
  await uploadItem(canDownloadItem);

  let trans: { transId: string; hash: string; }[] = [];
  try {
    trans = await addItemToTransmission(canDownloadItem);
  } catch (e) {
    log.log(e.message);
    log.log(e.stack);
  }

  // 8.
  await updateTrans2Item(trans, canDownloadItem);
  await mysql.setItemDownloading(canDownloadItem);
  await utils.sleep(5 * 1000);
  // 9. 
  const downloadingItems: TItem[] = await getDownloadingItems();
  // 10. 
  const beyondFreeItems: TItem[] = await filterBeyondFreeItems(downloadingItems);
  // 11. 
  await removeItemFromTransmission(beyondFreeItems);
  log.log(`[${utils.displayTime()}] all task done!!!!\n`);
  // 12.
  await reduceLeftSpace();

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

async function getRssContent(): Promise<string> {
  log.log(`[${utils.displayTime()}] get rss content`);
  const configInfo: config.TTBSConfig = config.getConfig();
  const res: AxiosResponse = await axios.get(configInfo.hdchina.rssLink);
  return res.data;
}

async function getItemInfo(rss: any): Promise<TItem[]> {
  log.log(`[${utils.displayTime()}] get item info`);
  const { item } = rss.rss.channel;
  const items: TItem[] = [];
  for(const it of item) {
    const { link, enclosure, title, guid } = it;
    const linkRes: UrlWithParsedQuery = parseUrl(link, true);
    const id: string = linkRes.query.id as string;
    const { '@_url': enclosureUrl, '@_length': length } = enclosure;
    const hashRes: UrlWithParsedQuery = parseUrl(enclosureUrl, true);
    const hash: string = hashRes.query.hash as string;
    items.push({
      id, hash,
      size: length,
      title,
      torrentUrl: enclosureUrl,
      transHash: guid['#text']
    });
  }
  return items;
}

async function filterFreeItem(items: TItem[], retryTime: number = 0): Promise<TItem[]> {
  log.log(`[${utils.displayTime()}] filterFreeItem`);
  const configInfo = config.getConfig();
  const { globalRetryTime } = configInfo.hdchina;
  if (retryTime >= globalRetryTime) {
    console.warn(`[${utils.displayTime()}] exceed max filter free time!`);
    return [];
  }
  retryTime++;
  log.log(`[${utils.displayTime()}] filterFreeItem with time: [${retryTime}]`);
  const ids: string[] = [];
  for (const item of items) {
    ids.push(item.id);
  }
  const itemDetail = await utils.getItemDetailByIds(ids);
  log.log('getItemDetailByIds', JSON.stringify(itemDetail, null, 4));
  const freeItem: TItem[] = [];
  let noneFreeCount: number = 0;
  for (let i = 0; i < items.length; i++) {
    const item: TItem = items[i];
    const ddlItem = itemDetail.message[item.id];
    const { sp_state, timeout } = ddlItem;
    if (
      -1 === sp_state.indexOf('display: none') && 
      (-1 < sp_state.indexOf('pro_free') || -1 < sp_state.indexOf('pro_free2up') ) &&
      '' !== timeout
    ) {
      const [ ddl ] = timeout.match(/\d\d\d\d-\d\d-\d\d\s\d\d:\d\d:\d\d/);
      const ddlTime: Date = new Date(ddl);
      item.freeUntil = ddlTime;
      item.free = true;
      freeItem.push(item);
    } else {
      noneFreeCount++;
      item.free = false;
    }
  }
  if (noneFreeCount === items.length) {
    return await filterFreeItem(items, retryTime);
  }
  log.message(`[${utils.displayTime()}] free item count: [${freeItem.length}]`);
  return freeItem;
}

async function downloadItem(items: TItem[]): Promise<void> {
  log.log(`[${utils.displayTime()}] downloadItem: [${JSON.stringify(items)}]`);
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
        log.log(`[${utils.displayTime()}] download torrent: [${fileName}], size: [${filesize(size)}], free time: [${moment(freeUntil).diff(moment(), 'hours')} H]`);
        downloadCount++;
      } catch (e) {
        downloadErrorCount++;
        console.error(`[ERROR][${utils.displayTime()}] download file: [${fileName}] with error: [${e.message}]`);
      }
    } else {
      existsTorrentCount++;
    }
  }
  log.message(`[${utils.displayTime()}]download number: [${downloadCount}], exists torrent count: [${existsTorrentCount}], download error count: [${downloadErrorCount}]`);
}

async function uploadItem(items: TItem[]): Promise<void> {
  log.log(`[${utils.displayTime()}] upload items: [${JSON.stringify(items)}]`);
  const configInfo = config.getConfig();
  for (const item of items) {
    const { hash } = item;
    const fileName: string = `${hash}.torrent`;
    const filePath: string = path.join(tempFolder, `${hash}.torrent`);
    await oss.uploadTorrent(fileName, filePath);
  }
}

async function addItemToTransmission(items: TItem[]): Promise<{transId: string; hash: string;}[]> {
  log.log(`[${utils.displayTime()}] addItemToTransmission: [${JSON.stringify(items)}]`);
  const transIds: {transId: string; hash: string;}[] = [];
  const configInfo = config.getConfig();
  const { cdnHost } = configInfo.hdchina.aliOss;
  for (const item of items) {
    const { hash, title } = item;
    const torrentUrl: string = `http://${cdnHost}/hdchina/${hash}.torrent`;
    log.log(`[${utils.displayTime()}] add file to transmission: [${title}]`);
    try {
      const transRes: { transId: string; hash: string } = await transmission.addUrl(torrentUrl);
      transIds.push(transRes);
    } catch(e) {
      log.log(e.message);
      log.log(e.stack);
    }
  }
  return transIds;
}

async function updateTrans2Item(transIds: {transId: string; hash: string}[], items: TItem[]): Promise<void> {
  log.log(`[${utils.displayTime()}] updateTransId2Item transIds: [${JSON.stringify(transIds)}], items: [${JSON.stringify(items)}]`);
  const configInfo = config.getConfig();
  const { cdnHost } = configInfo.hdchina.aliOss;

  for (let i = 0; i < transIds.length; i++) {
    const { transId, hash } = transIds[i];
    const item: TItem = items[i];
    const { hash: torrentHash } = item;
    await mysql.updateItemByHash(torrentHash, {
      trans_id: transId,
      trans_hash: hash,
      torrent_download_url: `http://${cdnHost}/hdchina/${torrentHash}.torrent`
    });
  }
}

async function getDownloadingItems(): Promise<TItem[]> {
  log.log(`[${utils.displayTime()}] getDownloadingItems`);
  const downloadingTransItems: transmission.TTransItem[] = await transmission.getDownloadingItems();
  const downloadingHash: string[] = [];
  const configInfo = config.getConfig();
  const { fileDownloadPath } = configInfo.hdchina.transmission;
  for (const item of downloadingTransItems) {
    const { hash, downloadDir } = item;
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
  log.log(`[${utils.displayTime()}] downloading item names: [${downloadingItemNames.join('\n')}]`);
  return downloadingItems;
}

async function filterBeyondFreeItems(items: TItem[]): Promise<TItem[]> {
  log.log(`[${utils.displayTime()}] filterBeyondFreeItems: [${JSON.stringify(items)}]`);
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
  log.log(`[${utils.displayTime()}] removeItemFromTransmission: [${JSON.stringify(items)}]`);
  const transIds: string[] = await mysql.getTransIdByItem(items);
  for (let i = 0; i < items.length; i++) {
    const transId: string = transIds[i];
    const item: TItem = items[i];
    log.log(`[${utils.displayTime()}] removing torrent: [${item.title}]`);
    await transmission.removeItem(Number(transId));
  }
  log.message(`[${utils.displayTime()}] remove torrent count: [${items.length}]`);
}

async function reduceLeftSpace(): Promise<void> {
  log.log(`[${utils.displayTime()}] reduceLeftSpace`);
  const configInfo = config.getConfig();
  let freeSpace: number = await transmission.freeSpace();
  const { minSpaceLeft, fileDownloadPath, minStayFileSize } = configInfo.hdchina.transmission;
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
      log.message(`[${utils.displayTime()}] remove item because of min left space: [${name}], size: [${filesize(size)}]`);
      reducedTotal += size;
      await transmission.removeItem(id);
      freeSpace += size;
    }
  }
  log.message(`[${utils.displayTime()}] reduce space total: [${filesize(reducedTotal)}]`);
}

start();

process.on('uncaughtException', async (e) => {
  log.log(e.message);
  log.log(e.stack);
  await message.sendMessage();
  await utils.sleep(5 * 1000);
  throw e;
});

process.on('uncaughtException', async (e) => {
  console.error(e);
  await message.sendMessage();
  await utils.sleep(5 * 1000);
  process.exit(1);
})
