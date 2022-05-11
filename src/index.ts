
// @ts-ignore:next-line
import { XMLParser } from 'fast-xml-parser';

import axios, { AxiosResponse } from 'axios';
import * as _ from 'lodash';
import { parse as parseUrl, UrlWithParsedQuery } from 'url';
import * as fs from 'fs';
import * as path from 'path';
import * as filesize from 'filesize';
import * as moment from 'moment';
import * as cheerio from 'cheerio';

import * as config from './config';
import * as utils from './utils';
import * as transmission from './transmission';
import * as oss from './oss';
import * as message from './message';
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
  torrentHash?: string;
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
  // const userInfo: puppeteer.TPageUserInfo = await puppeteer.getUserInfo();
  // log.message(`share ratio: [${userInfo.shareRatio || ''}]`);
  // log.message(`upload count: [${userInfo.uploadCount || ''}]`);
  // log.message(` download count: [${userInfo.downloadCount || ''}]`);
  // log.message(`matic point: [${userInfo.magicPoint || ''}]`)

  const rssString: string = await getRssContent();
  const parser: XMLParser = new XMLParser({
    ignoreAttributes: false
  });
  // 2. 
  const rss: object = parser.parse(rssString);
  // 3.
  const items: TItem[] = await getItemInfo(rss);

  // await mysql.storeItem(items);
  let canDownloadItem: TItem[] = await mysql.getCanDownloadItems();
  if (canDownloadItem.length > 5) {
    log.log(`too much download item: [${canDownloadItem.length}], reduce to 5`);
    log.message(`total download item: [${canDownloadItem.length}], current download: [${5}]`);
    canDownloadItem = canDownloadItem.splice(0, 5);
  }

  const successItems: TItem[] = await downloadItem(canDownloadItem);
  await uploadItem(successItems);

  let trans: { transId: string; hash: string; }[] = [];
  try {
    trans = await addItemToTransmission(successItems);
  } catch (e) {
    log.log(e.message);
    log.log(e.stack);
  }

  await updateTrans2Item(trans, successItems);
  await mysql.setItemDownloading(successItems);

  const downloadingFreeItem: TItem[] = await getDownloadingItemFreeTime(successItems);

  await mysql.updateItemFreeStatus(downloadingFreeItem);

  // 9. 
  const downloadingItems: TItem[] = await getDownloadingItems();
  // 10. 
  const beyondFreeItems: TItem[] = await filterBeyondFreeItems(downloadingItems);
  // 11.
  // await removeItemFromTransmission(beyondFreeItems);
  log.log(`all task done!!!!\n`);
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
  const { tempFolder: tempFolderConfig } = configInfo
  const fullTempFolder = path.join(__dirname, tempFolderConfig);
  mkdirpSync(fullTempFolder);
  tempFolder = fullTempFolder;
}

async function getRssContent(): Promise<string> {
  log.log(`get rss content`);
  const configInfo: config.TTBSConfig = config.getConfig();
  const res: AxiosResponse = await axios.get(configInfo.rssLink);
  return res.data;
}

async function getItemInfo(rss: any): Promise<TItem[]> {
  log.log(`get item info`);
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
      torrentHash: guid['#text']
    });
  }
  return items;
}

async function downloadItem(items: TItem[]): Promise<TItem[]> {
  log.log(`downloadItem: [${JSON.stringify(items)}]`);
  const configInfo = config.getConfig();
  const { downloadUrl, uid } = configInfo
  let downloadCount: number = 0;
  let existsTorrentCount: number = 0;
  let downloadErrorCount: number = 0;
  const downloadSuccessItems: TItem[] = []
  for (const item of items) {
    await utils.sleep(2 * 1000);
    const { hash, title, id, size, freeUntil, torrentHash } = item;
    const fileName: string = path.join(tempFolder, `${torrentHash}.torrent`);
    if (true === fs.existsSync(fileName)) {
      existsTorrentCount++;
    }
    try {
      // not exist, download
      const downloadLink = `${downloadUrl}?hash=${hash}&uid=${uid}`;
      const fileWriter = fs.createWriteStream(fileName);
      log.log(`downloading torrent with url: [${downloadLink}]`);
      const res: AxiosResponse = await axios({
        url: downloadLink,
        method: 'get',
        responseType: 'stream',
        headers: {
          ...utils.downloadHeader
        }
      });
      await utils.writeFile(res.data, fileWriter);
      log.log(`download torrent: [${fileName}], size: [${filesize(size)}]]`);
      downloadCount++;
      downloadSuccessItems.push(item);
    } catch (e) {
      downloadErrorCount++;
      console.error(`[ERROR]download file: [${fileName}] with error: [${e.message}]`);
    }
  }
  log.message(`download number: [${downloadCount}]`);
  log.message(`exists torrent count: [${existsTorrentCount}]`);
  log.message(`download error count: [${downloadErrorCount}]`);
  return downloadSuccessItems;
}

async function uploadItem(items: TItem[]): Promise<void> {
  log.log(`upload items: [${JSON.stringify(items)}]`);
  const configInfo = config.getConfig();
  for (const item of items) {
    const { torrentHash } = item;
    const fileName: string = `${torrentHash}.torrent`;
    const filePath: string = path.join(tempFolder, `${torrentHash}.torrent`);
    await oss.uploadTorrent(fileName, filePath);
  }
}

async function addItemToTransmission(items: TItem[]): Promise<{transId: string; hash: string;}[]> {
  log.log(`addItemToTransmission: [${JSON.stringify(items)}]`);
  const transIds: {transId: string; hash: string;}[] = [];
  const configInfo = config.getConfig();
  const { cdnHost } = configInfo.aliOss;
  let errorCount: number = 0;
  for (const item of items) {
    const { torrentHash, title } = item;
    const torrentUrl: string = `http://${cdnHost}/hdchina/${torrentHash}.torrent`;
    log.log(`add file to transmission: [${title}]`);
    try {
      const transRes: { transId: string; hash: string } = await transmission.addUrl(torrentUrl);
      transIds.push(transRes);
    } catch(e) {
      errorCount++;
      log.log(e.message);
      log.log(e.stack);
    }
  }
  log.message(`add transmission error count: [${errorCount}]`);
  return transIds;
}

async function getDownloadingItemFreeTime(items: TItem[]): Promise<TItem[]> {
  log.log(`getDownloadingItemFreeTime, length: [${JSON.stringify(items)}]`);
  const resHtml = await utils.getDownloadingItemFreeTime();
  const $ = cheerio.load(resHtml);
  const freeItems = $('table td .pro_free');
  const freeItemMap: Map<string, Date> = new Map();
  for (const item of freeItems) { 
    const $item = $(item);
    const freeTimeContainer = $item.parent().html();
    const [ freeTime ] = freeTimeContainer.match(/\d\d\d\d-\d\d-\d\d\s\d\d:\d\d:\d\d/);
    const [ pattern, id ] = freeTimeContainer.match(/details.php\?id=(\d+)/);
    const freeTimeDate: Date = new Date(freeTime);
    freeItemMap.set(id, freeTimeDate);
    log.log(`got free item, id:[${id}], free time date: [${freeTimeDate}]`);
  }
  for (const item of items) {
    const { id } = item;
    const freeTime: Date|undefined = freeItemMap.get(id);
    if (undefined === freeTime) {
      item.free = false;
    } else {
      item.free = true;
      item.freeUntil = freeTime;
    }
  }
  return items;
}

async function updateTrans2Item(transIds: {transId: string; hash: string}[], items: TItem[]): Promise<void> {
  log.log(`updateTransId2Item transIds: [${JSON.stringify(transIds)}], items: [${JSON.stringify(items)}]`);
  const configInfo = config.getConfig();
  const { cdnHost } = configInfo.aliOss;

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
  log.log(`getDownloadingItems`);
  const downloadingTransItems: transmission.TTransItem[] = await transmission.getDownloadingItems();
  const downloadingHash: string[] = [];
  const configInfo = config.getConfig();
  const { fileDownloadPath } = configInfo.transmission;
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
  log.log(`downloading item names: [${downloadingItemNames.join('\n')}]`);
  return downloadingItems;
}

async function filterBeyondFreeItems(items: TItem[]): Promise<TItem[]> {
  log.log(`filterBeyondFreeItems: [${JSON.stringify(items)}]`);
  const beyondFreeItems: TItem[] = [];
  for (const item of items) {
    const { freeUntil, free } = item;
    if ( false === free ||  moment(freeUntil) < moment()) {
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
    log.log(`removing torrent: [${item.title}]`);
    await transmission.removeItem(Number(transId));
  }
  log.message(`remove torrent count: [${items.length}]`);
}

async function reduceLeftSpace(): Promise<void> {
  log.log(`reduceLeftSpace`);
  const configInfo = config.getConfig();
  let freeSpace: number = await transmission.freeSpace();
  const { minSpaceLeft, fileDownloadPath, minStayFileSize } = configInfo.transmission;
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
      await transmission.removeItem(id);
      freeSpace += size;
    }
  }
  log.message(`reduce space total: [${filesize(reducedTotal)}]`);
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
