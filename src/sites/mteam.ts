
import * as moment from 'moment';
import * as puppeteer from 'puppeteer';
import { TItem, TPTUserInfo } from '../types';
import * as utils from '../utils';
import * as log from '../log';
import * as config from '../config';
import * as mysql from '../mysql';

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
    const [trash1, magicPoint] = magicPointContent.match(/魔力值\s\[使用\]\:(.*)\s邀請/)  || ['', ''];
    const [trash2, shareRatio] = magicPointContent.match(/分享率： (\d*\.*\d*)\s/) || ['', ''];
    const [trash3, uploadCount] = magicPointContent.match(/上傳量： (\d*\.*\d*)\s/)  || ['', ''];
    const [trash4, downloadCount] = magicPointContent.match(/下載量： (\d*\.*\d*)\s/)  || ['', ''];
    userInfo.shareRatio = shareRatio.replace(',', '');
    userInfo.magicPoint = magicPoint.replace(',', '').trim();
    userInfo.downloadCount = downloadCount.replace(',', '');
    userInfo.uploadCount = uploadCount.replace(',', '');
  } catch (e) {
    log.log(`[SITE] [MTEAM] get user info: [${e.message}], [${e.stack}]`);
  }
  return userInfo;
}

export async function getFreeTime(el: puppeteer.ElementHandle): Promise<Date> {
  const freeTimeContainer: string = await el.$eval('.pro_free', (el) => el.parentElement.textContent);
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
  const titleEl = await el.$('.embedded a b');
  if (null === titleEl) {
    return '';
  }
  const title: any = await el.$eval('.embedded a b', (el) => el.textContent);
  return title;
}

export async function getSize(el: puppeteer.ElementHandle): Promise<number> {
  try {
    const sizeString = await el.$eval('td:nth-child(5)', (el) => el.textContent);
    const [ sizeNumberString ] = sizeString.match(/\d*\.*\d*/);
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
  } catch (e) {
    return 0;
  }
}

export async function getDownloadUrl(item: TItem): Promise<string> {
  return item.torrentUrl;
}

export async function getDownloadHeader(): Promise<any> {
  const cookies: puppeteer.SetCookie[] = await utils.getUserCookie(config.uid);
  let cookieString: string = '';
  for (const cookie of cookies) {
    cookieString += `${cookie.name}=${cookie.value};`
  }
  return {
    ...utils.downloadHeader,
    cookie: cookieString
  }
}

export async function isDownloaded(el: puppeteer.ElementHandle): Promise<boolean> {
  const progress: string = await el.$eval('td:nth-child(9)', (el) => el.textContent);
  return '--' !== progress;
}

export async function publishDate(el: puppeteer.ElementHandle): Promise<Date> {
  const dateString: string = await el.$eval('td:nth-child(4) span', (el) => el.getAttribute('title'));
  return new Date(dateString);
}

export async function isSticky(el: puppeteer.ElementHandle): Promise<boolean> {
  const stickyFlag = await el.$('.sticky');
  return null !== stickyFlag;
}