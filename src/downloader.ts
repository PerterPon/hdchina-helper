



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
    const fileName: string = path.join(tempFolder, `${hash}_${uid}.torrent`);
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

async function uploadItem(items: TItem[]): Promise<void> {
  log.log(`upload items: [${JSON.stringify(items)}]`);
  const configInfo = config.getConfig();
  const { uid } = configInfo.hdchina;
  for (const item of items) {
    const { hash } = item;
    const fileName: string = `${uid}/${hash}.torrent`;
    const filePath: string = path.join(tempFolder, `${hash}_${uid}.torrent`);
    await oss.uploadTorrent(fileName, filePath);
  }
}

async function addItemToTransmission(items: TItem[]): Promise<{transId: string; hash: string;}[]> {
  log.log(`addItemToTransmission: [${JSON.stringify(items)}]`);
  const transIds: {transId: string; hash: string;}[] = [];
  const configInfo = config.getConfig();
  const { cdnHost } = configInfo.hdchina.aliOss;
  const { uid } = configInfo.hdchina;
  let errorCount: number = 0;
  for (const item of items) {
    const { hash, title } = item;
    const torrentUrl: string = `http://${cdnHost}/hdchina/${uid}/${hash}.torrent`;
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

async function updateTrans2Item(transIds: {transId: string; hash: string}[], items: TItem[]): Promise<void> {
  log.log(`updateTransId2Item transIds: [${JSON.stringify(transIds)}], items: [${JSON.stringify(items)}]`);
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
  log.log(`getDownloadingItems`);
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
  log.message(`remove torrent count: [${items.length}]`);
}

async function reduceLeftSpace(): Promise<void> {
  log.log(`reduceLeftSpace`);
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
      log.message(`remove item because of min left space: [${name}], size: [${filesize(size)}]`);
      reducedTotal += size;
      await transmission.removeItem(id);
      freeSpace += size;
    }
  }
  log.message(`reduce space total: [${filesize(reducedTotal)}]`);
}
