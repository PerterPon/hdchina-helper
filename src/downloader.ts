
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
import { mkdirpSync } from 'fs-extra';
import * as log from './log';
import { siteMap } from './sites/basic';

import { TItem } from './types';

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

  let trans: { transId: string; hash: string; }[] = [];
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
  await transmission.init();
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
  const configInfo = config.getConfig();
  const { downloadUrl,  } = configInfo;
  let downloadCount: number = 0;
  let existsTorrentCount: number = 0;
  let downloadErrorCount: number = 0;
  const downloadSuccessItems: TItem[] = [];
  for (const item of items) {
    await utils.sleep(2 * 1000);
    const { site, title, id, size, freeUntil, torrentUrl } = item;
    const fileName: string = path.join(tempFolder, `${site}_${id}_${config.uid}.torrent`);
    if (true === fs.existsSync(fileName)) {
      existsTorrentCount++;
      downloadSuccessItems.push(item);
      continue;
    }

    try {
      // not exist, download
      const downloadLink = await siteMap[config.site].getDownloadUrl(item);
      
      const fileWriter = fs.createWriteStream(fileName);
      const downloadHeader = await siteMap[config.site].getDownloadHeader();
      log.log(`download link: [${downloadLink}], header: [${JSON.stringify(downloadHeader)}]`);
      const res: AxiosResponse = await axios({
        url: downloadLink,
        method: 'get',
        responseType: 'stream',
        headers: downloadHeader
      });
      await utils.writeFile(res.data, fileWriter);
      const leftTime: number = moment(freeUntil).unix() - moment().unix();
      log.log(`download torrent: [${fileName}], size: [${filesize(size)}], free time: [${moment(freeUntil).diff(moment(), 'hours')} H]`);
      downloadCount++;
      downloadSuccessItems.push(item);
    } catch (e) {
      downloadErrorCount++;
      console.error(`[ERROR]download file: [${fileName}] with error: [${e.message}]`);
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

async function addItemToTransmission(items: TItem[]): Promise<{transId: string; hash: string;}[]> {
  log.log(`addItemToTransmission: [${JSON.stringify(items)}]`);
  const transIds: {transId: string; hash: string;}[] = [];
  const configInfo = config.getConfig();
  const { cdnHost } = configInfo.aliOss;
  let errorCount: number = 0;
  for (const item of items) {
    const { site, uid, id, title } = item;
    const torrentUrl: string = `http://${cdnHost}/hdchina/${uid}/${site}_${id}.torrent`;
    log.log(`add file to transmission: [${title}]`);
    try {
      const transRes: { transId: string; hash: string } = await transmission.addUrl(torrentUrl);
      transIds.push(transRes);
    } catch(e) {
      if ('invalid or corrupt torrent file' === e.message) {
        transIds.push({
          transId: '0',
          hash: '0'
        });
      } else {
        transIds.push({
          transId: '-1',
          hash: '-1'
        });
      }
      errorCount++;
      log.log(e.message);
      log.log(e.stack);
    }
  }
  if (0 < errorCount) {
    log.message(`add transmission error count: [${errorCount}]`);
  }
  return transIds;
}

async function storeDownloadAction(transIds: {transId: string; hash: string}[], items: TItem[]): Promise<void> {
  log.log(`updateTransId2Item transIds: [${JSON.stringify(transIds)}], items: [${JSON.stringify(items)}]`);
  const configInfo = config.getConfig();

  for (let i = 0; i < transIds.length; i++) {
    const { transId, hash } = transIds[i];
    if ('-1' === transId) {
      continue;
    }
    const item: TItem = items[i];
    const { site, id, uid } = item;
    await mysql.updateTorrentHashBySiteAndId(site, id, hash);
    await mysql.storeDownloadAction(site, id, uid, transId, hash);
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
    log.log(`removing torrent: [${item.title}]`);
    await transmission.removeItem(Number(transId));
  }
  if (0 < items.length) {
    log.message(`remove torrent count: [${items.length}]`);
  }
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
  if (0 < reducedTotal) {
    log.message(`reduce space total: [${filesize(reducedTotal)}]`);
  }
}



// start();
