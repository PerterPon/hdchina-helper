
import * as config from './config';
import { sleep, displayTime } from './utils';
import axios, { AxiosResponse } from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { parse as parseUrl, UrlWithParsedQuery } from 'url';
import * as qs from 'qs';
import * as fs from 'fs';
import * as path from 'path';
import * as filesize from 'filesize';
import * as moment from 'moment';

config.init();

interface TItem {
  id: string;
  hash: string;
  free?: boolean;
  freeUntil?: Date;
  size: number;
  title: string;
}

const configInfo: config.TTBSConfig = config.getConfig();

let totalItems: TItem[] = [];

async function main(): Promise<void> {
  await config.init();
  // 1. 
  const rssString: string = await getRssContent();
  const parser: XMLParser = new XMLParser({
    ignoreAttributes: false
  });
  // 2. 
  const rss: object = parser.parse(rssString);
  // 3.
  const items: TItem[] = await getItemInfo(rss);
  totalItems = items;
  // 4.
  const freeItems: TItem[] = await filterFreeItem(items);
  console.log(`[${displayTime()}] free items: [${JSON.stringify(freeItems)}]`);
  // 5.
  await downloadItem(freeItems);
}

async function getRssContent(): Promise<string> {
  console.log(`[${displayTime()}] get rss content`);
  const configInfo: config.TTBSConfig = config.getConfig();
  const res: AxiosResponse = await axios.get(configInfo.hdchina.rssLink);
  return res.data;
}

async function getItemInfo(rss: any): Promise<TItem[]> {
  console.log(`[${displayTime()}] get item info`);
  const { item } = rss.rss.channel;
  const items: TItem[] = [];
  for(const it of item) {
    const { link, enclosure, title } = it;
    const linkRes: UrlWithParsedQuery = parseUrl(link, true);
    const id: string = linkRes.query.id as string;
    const { '@_url': enclosureUrl, '@_length': length } = enclosure;
    const hashRes: UrlWithParsedQuery = parseUrl(enclosureUrl, true);
    const hash: string = hashRes.query.hash as string;
    items.push({
      id, hash,
      size: length,
      title
    });
  }
  return items;
}

async function filterFreeItem(items: TItem[], retryTime: number = 0): Promise<TItem[]> {
  const configInfo = config.getConfig();
  const { cookie, checkFreeUrl, globalRetryTime } = configInfo.hdchina;
  if (retryTime >= globalRetryTime) {
    console.warn(`[${displayTime()}] exceed max filter free time!`);
    return [];
  }
  retryTime++;
  console.log(`[${displayTime()}] filterFreeItem with time: [${retryTime}]`);
  const ids: string[] = [];
  for (const item of items) {
    ids.push(item.id);
  }
  const csrfToken: string = await fetchCsrfToken();
  const res: AxiosResponse = await axios({
    method: 'post',
    url: checkFreeUrl,
    data: qs.stringify({
      ids,
      csrf: csrfToken
    }),
    headers: {
      ...ajaxHeader,
      "cookie": cookie,
    },
    responseType: 'json'
  });
  const resData = res.data as any;
  console.log(res.data);;
  const freeItem: TItem[] = [];
  let noneFreeCount: number = 0;
  for (let i = 0; i < items.length; i++) {
    const item: TItem = items[i];
    const ddlItem = resData.message[item.id];
    const { sp_state, timeout } = ddlItem;
    if (
      -1 === sp_state.indexOf('display: none') && 
      -1 < sp_state.indexOf('pro_free') &&
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
  return freeItem;
}

async function downloadItem(items: TItem[]): Promise<void> {
  console.log(`[${displayTime()}] downloadItem: [${JSON.stringify(items)}]`);
  const configInfo = config.getConfig();
  const { downloadUrl, uid, downloadPath } = configInfo.hdchina;
  let downloadCount: number = 0;
  let existsTorrentCount: number = 0;
  let downloadErrorCount: number = 0;
  for (const item of items) {
    await sleep(2 * 1000);
    const { hash, title, id, size, freeUntil } = item;
    const fileName: string = path.join(downloadPath, `${id}_${title}.torrent`);
    if (false === fs.existsSync(fileName)) {
      try {
        // not exist, download
        const downloadLink = `${downloadUrl}?hash=${hash}&uid=${uid}`;
        const fileWriter = fs.createWriteStream(fileName);
        const res: AxiosResponse = await axios({
          url: downloadLink,
          method: 'get',
          responseType: 'stream'
        });
        await writeFile(res.data, fileWriter);
        const leftTime: number = moment(freeUntil).unix() - moment().unix();
        console.log(`[${displayTime()}] download torrent: [${fileName}], size: [${filesize(size)}], free time: [${moment(freeUntil).diff(moment(), 'hours')} H]`);
        downloadCount++;
      } catch (e) {
        downloadErrorCount++;
        console.error(`[ERROR][${displayTime()}] download file: [${fileName}] with error: [${e.message}]`);
      }
    } else {
      existsTorrentCount++;
    }
  }
  console.log(`[${displayTime()}] all torrents download complete! download number: [${downloadCount}], exists torrent count: [${existsTorrentCount}], download error count: [${downloadErrorCount}]`);
}

function writeFile(from: fs.ReadStream, to: fs.WriteStream): Promise<void> {
  from.pipe(to);
  return new Promise((resolve, reject) => {
    to.on('finish', resolve);
    to.on('error', reject);
  });
}

async function fetchCsrfToken(): Promise<string> {
  console.log(`[${displayTime()}] fetch csrf token`);
  const configInfo = config.getConfig();
  const { cookie, indexPage } = configInfo.hdchina;
  const res: AxiosResponse = await axios.get(indexPage, {
    headers: {
      ...htmlHeader,
      cookie
    }
  });
  const html: string = res.data;
  const [_, csrfToken] = html.match(/name="x-csrf"\scontent="(.*)"/);
  console.log(`[${displayTime()}] got token: [${csrfToken}]`);
  return csrfToken;
}

const ajaxHeader = {
  "accept": "*/*",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7,zh-TW;q=0.6",
  "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
  "sec-ch-ua": "\" Not A;Brand\";v=\"99\", \"Chromium\";v=\"99\", \"Google Chrome\";v=\"99\"",
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": "\"macOS\"",
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "x-requested-with": "XMLHttpRequest",
  "Referer": "https://hdchina.org/torrents.php",
  "Referrer-Policy": "strict-origin-when-cross-origin"
};

const htmlHeader = {
  "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7,zh-TW;q=0.6",
  "cache-control": "max-age=0",
  "sec-ch-ua": "\" Not A;Brand\";v=\"99\", \"Chromium\";v=\"99\", \"Google Chrome\";v=\"99\"",
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": "\"macOS\"",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "same-origin",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
  "Referer": "https://hdchina.org/torrents.php",
  "Referrer-Policy": "strict-origin-when-cross-origin"
};

main();
