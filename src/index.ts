
import * as config from './config';
import { sleep, displayTime } from './utils';
import axios, { AxiosResponse } from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { parse as parseUrl, UrlWithParsedQuery } from 'url';
import * as qs from 'qs';
import * as fs from 'fs';
import * as path from 'path';

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

async function filterFreeItem(items: TItem[]): Promise<TItem[]> {
  console.log(`[${displayTime()}] filterFreeItem`);
  const ids: string[] = [];
  for (const item of items) {
    ids.push(item.id);
  }
  const configInfo = config.getConfig();
  const { cookie, csrfToken, checkFreeUrl } = configInfo.hdchina;
  const res: AxiosResponse = await axios({
    method: 'post',
    url: checkFreeUrl,
    data: qs.stringify({
      ids,
      csrf: csrfToken
    }),
    headers: {
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
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "cookie": cookie,
    },
    responseType: 'json'
  });
  const resData = res.data as any;
  console.log(res.data);;
  const freeItem: TItem[] = [];
  for (let i = 0; i < items.length; i++) {
    const item: TItem = items[i];
    const ddlItem = resData.message[item.id];
    const { sp_state, timeout } = ddlItem;
    if (-1 < sp_state.indexOf('pro_free')) {
      const [ ddl ] = timeout.match(/\d\d\d\d-\d\d-\d\d\s\d\d:\d\d:\d\d/);
      const ddlTime: Date = new Date(ddl);
      item.freeUntil = ddlTime;
      item.free = true;
      freeItem.push(item);
    } else {
      item.free = false;
    }
  }
  return freeItem;
}

async function downloadItem(items: TItem[]): Promise<void> {
  console.log(`[${displayTime()}] downloadItem: [${JSON.stringify(items)}]`);
  const configInfo = config.getConfig();
  const { downloadUrl, uid, downloadPath } = configInfo.hdchina;
  for (const item of items) {
    const { hash, title, id } = item;
    const fileName: string = path.join(downloadPath, `${id}_${title}.torrent`);
    // not exist, download
    if (false === fs.existsSync(fileName)) {
      const downloadLink = `${downloadUrl}?hash=${hash}&uid=${uid}`;
      const res = await axios(downloadLink);
      fs.writeFileSync(fileName, res.data);
      console.log(`[${displayTime()}] download torrent: [${fileName}]`);
    }
  }
}

main();
