
import * as moment from 'moment';
import * as puppeteer from 'puppeteer';
import { TItem } from '../types';
import * as utils from '../utils';
import * as config from '../config';

import { TPageUserInfo } from "./basic";


export async function getUserInfo(torrentPage: puppeteer.Page): Promise<TPageUserInfo> {
  let magicP: puppeteer.ElementHandle<HTMLParagraphElement> = null;
  let ratioP: puppeteer.ElementHandle<HTMLParagraphElement> = null;
  const userInfo: TPageUserInfo = {
    shareRatio: '0',
    uploadCount: '0',
    downloadCount: '0',
    magicPoint: '0'
  };

  try {
    magicP = await torrentPage.$('#info_block .bottom');
    const magicPointContent: string = await magicP.evaluate((el) => el.textContent) || '';
    const [trash1, magicPoint] = magicPointContent.match(/魔力值\s\[使用\]\:(.*)\s邀請/);
    const [trash2, shareRatio] = magicPointContent.match(/分享率： (.*)  上傳量/);
    const [trash3, uploadCount] = magicPointContent.match(/上傳量： (.*) GB 下載量/);
    const [trash4, downloadCount] = magicPointContent.match(/下載量： (.*) GB/);
    userInfo.shareRatio = shareRatio.replace(',', '');
    userInfo.magicPoint = magicPoint.replace(',', '');
    userInfo.downloadCount = downloadCount.replace(',', '');
    userInfo.uploadCount = uploadCount.replace(',', '');
  } catch (e) {}
  return userInfo;
}

export async function getFreeTime(el: puppeteer.ElementHandle): Promise<Date> {
  const freeTimeContainer: string = await el.$eval('.pro_free', (el) => el.parentElement.textContent);
  const [pattern, day] = freeTimeContainer.match(/限時：(\d.*)日/);
  const [pattern2, hour] = freeTimeContainer.match(/(\d.*)時/);
  const now: moment.Moment = moment();
  now.add(day || 0, 'day');
  now.add(hour, 'hour');
  return now.toDate();
}

export async function getFreeTime2up(el: puppeteer.ElementHandle): Promise<Date> {
  const freeTimeContainer: string = await el.$eval('.pro_free2up', (el) => el.parentElement.textContent);
  const [pattern, day] = freeTimeContainer.match(/限時：(\d.*)日/) || [];
  let [pattern2, hour] = freeTimeContainer.match(/日(\d.*)時/) || [];
  if (undefined === hour) {
    [pattern2, hour] = freeTimeContainer.match(/限時：(\d.*)時/) || [];
  }
  const [pattern3, min] = freeTimeContainer.match(/時(\d.*)分/) || [];
  const now: moment.Moment = moment();
  if (undefined === day && undefined == hour && undefined === min) {
    now.add(10, 'day');
  } else {
    now.add(day || 0, 'day');
    now.add(hour || 0, 'hour');
    now.add(min || 0, 'minute');
  }
  return now.toDate();
}

export async function getSiteId(el: puppeteer.ElementHandle, torrentUrl): Promise<string> {
  const idHref = await el.$eval('.download', (el) => el.parentElement.getAttribute('href'));
  const [trash, id] = idHref.match(/id=(\d+)&/);
  return id;
}

export async function getTitle(el: puppeteer.ElementHandle): Promise<string> {
  const title: any = await el.$eval('.embedded a b', (el) => el.textContent);
  return title;
}

export async function getSize(el: puppeteer.ElementHandle): Promise<number> {
  return 0;
  const row = await el.$('td:nth-child(5)');
  console.log(row);
  const sizeString = await el.$eval('td:nth-child(5)', (el) => el.innerHTML);
  const [ sizeNumberString ] = sizeString.match(/\d+.*\d+/);
  const sizeNumber: number = Number(sizeNumberString)
  let size: number = 0;
  if (-1 < sizeString.indexOf('GB')) {
    size = sizeNumber * 1024 * 1024 * 1024
  } else if (-1 < sizeString.indexOf('MB')) {
    size = sizeNumber * 1024 * 1024;
  } else if (-1 < sizeString.indexOf('TB')) {
    size = sizeNumber * 1024 * 1024 * 1024;
  }
  return size;
}

export async function getDownloadUrl(item: TItem): Promise<string> {
  return item.torrentUrl;
}

export async function getDownloadHeader(): Promise<any> {
  const configInfo = config.getConfig();
  const { name, value } = configInfo.puppeteer.cookie;
  return {
    ...utils.downloadHeader,
    cookie: `${name}=${value}`
  }
}

