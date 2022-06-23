
import * as moment from 'moment';
import * as cheerio from 'cheerio';
import * as puppeteer from 'puppeteer';
import { TItem, TPTUserInfo } from '../types';
import * as utils from '../utils';
import * as log from '../log';
import * as config from '../config';
import * as mysql from '../mysql';

import { TPageUserInfo } from "./basic";

export async function getUserInfo(torrentPage: cheerio.CheerioAPI): Promise<TPageUserInfo> {
  const userInfo: TPageUserInfo = {
    shareRatio: '0',
    uploadCount: '0',
    downloadCount: '0',
    magicPoint: '0'
  };

  try {
    const magicPointContent: string = await torrentPage('#info_block .bottom').text();
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

export async function getFreeTime(el: cheerio.CheerioAPI): Promise<Date> {
  const freeEl = el('.pro_free');
  if (0 === freeEl.length) {
    return null;
  }
  const freeTimeContainer: string = freeEl.parent().text(); // el.$eval('.pro_free', (el) => el.parentElement.textContent);
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

export async function getFreeTime2up(el: cheerio.CheerioAPI): Promise<Date> {
  const freeEl = el('.pro_free2up');
  if (0 === freeEl.length) {
    return null;
  }

  const freeTimeContainer: string = freeEl.parent().text();
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

export async function getSiteId(el: cheerio.CheerioAPI, torrentUrl): Promise<string> {
  const idHref: string= el('.download').parent().attr('href');
  // const idHref = await el.$eval('.download', (el) => el.parentElement.getAttribute('href'));
  const [trash, id] = idHref.match(/id=(\d+)&/);
  return id;
}

export async function getTitle(el: cheerio.CheerioAPI): Promise<string> {
  // const titleEl = await el.$('.embedded a b');
  const titleEl = el('.embedded a b');
  if (null === titleEl) {
    return '';
  }
  const title: any = titleEl.text(); // await el.$eval('.embedded a b', (el) => el.textContent);
  return title;
}

export async function getSize(el: cheerio.CheerioAPI): Promise<number> {
  try {
    // const sizeString = await el.$eval('td:nth-child(5)', (el) => el.textContent);
    const sizeString = await el('td:nth-child(5)').text();
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

export async function isDownloaded(el: cheerio.CheerioAPI): Promise<boolean> {
  // const peerActive = await el.$('.peer-active');
  const peerActive = await el('.peer-active');
  return 0 < peerActive.length;
}

export async function publishDate(el: cheerio.CheerioAPI): Promise<Date> {
  // const dateString: string = await el.$eval('td:nth-child(4) span', (el) => el.getAttribute('title'));
  const dateString: string = await el('td:nth-child(4) span').attr('title');
  return utils.parseCSTDate(dateString);
}

export async function isSticky(el: cheerio.CheerioAPI): Promise<boolean> {
  // const stickyFlag = await el.$('.sticky');
  const stickyFlag = await el('.sticky');
  return 0 < stickyFlag.length;
}

export async function checkFreeItem(el: cheerio.CheerioAPI): Promise<boolean> {
  const { siteAnchor } = config.getConfig();
  let freeItem = el(siteAnchor.freeItem1up);
  if (null === freeItem) {
    freeItem = el(siteAnchor.freeItem2up);
  }

  return null !== freeItem;
}

export async function getRssLink(): Promise<string> {
  const { rssLink } = config.getConfig();
  const userInfo: TPTUserInfo = config.userInfo;
  return `${rssLink}&passkey=${userInfo.passkey}`;
}
