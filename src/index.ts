
// @ts-ignore:next-line
import { XMLParser } from 'fast-xml-parser';

import axios, { AxiosResponse } from 'axios';
import * as _ from 'lodash';
import { parse as parseUrl, UrlWithParsedQuery } from 'url';
import * as fs from 'fs';
import * as path from 'path';
import * as filesize from 'filesize';

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
    log.message(`[RSS] ${config.site} ${config.uid}`);
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

  const rssString: string = await getRssContent();
  const parser: XMLParser = new XMLParser({
    ignoreAttributes: false
  });
  // 2. 
  const rss: object = parser.parse(rssString);
  // 3.
  let items: TItem[] = await getItemInfoMteam(rss);
  const successItems: TItem[] = await downloadItem(items);
  await uploadItem(successItems);

  let trans: { transId: string; hash: string; }[] = [];
  try {
    trans = await addItemToTransmission(successItems);
  } catch (e) {
    log.log(e.message);
    log.log(e.stack);
  }

  log.log(`all task done!!!!\n`);

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

async function getItemInfoMteam(rss: any): Promise<TItem[]> {
  log.log(`get item info`);
  const { item } = rss.rss.channel;
  const items: TItem[] = [];
  for(const it of item) {
    const { link, enclosure, title, guid } = it;
    const linkRes: UrlWithParsedQuery = parseUrl(link, true);
    const id: string = linkRes.query.id as string;
    const { '@_url': enclosureUrl, '@_length': length } = enclosure;
    const hashRes: UrlWithParsedQuery = parseUrl(enclosureUrl, true);
    const hash: string = guid['#text'];
    items.push({
      id, hash,
      size: length,
      title,
      torrentUrl: enclosureUrl,
      torrentHash: hash
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
      continue;
    }

    try {
      // not exist, download
      const downloadLink = item.torrentUrl;
      const fileWriter = fs.createWriteStream(fileName);
      log.log(`downloading torrent with url: [${downloadLink}]`);
      const res: AxiosResponse = await axios({
        url: downloadLink,
        method: 'get',
        responseType: 'stream',
        headers: {
          ...utils.downloadHeader
        },
        timeout: 600000
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
