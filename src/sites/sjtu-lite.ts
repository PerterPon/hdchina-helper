
import * as moment from 'moment';
import * as cheerio from 'cheerio';
import * as puppeteer from 'puppeteer';
import { TItem, TPTUserInfo } from '../types';
import * as utils from '../utils';
import * as log from '../log';
import * as config from '../config';
import * as urlLib from 'url';

import { TPageUserInfo } from "./basic";

export async function getUserInfo(torrentPage: cheerio.CheerioAPI): Promise<TPageUserInfo> {
  const userInfo: TPageUserInfo = {
    shareRatio: '0',
    uploadCount: '0',
    downloadCount: '0',
    magicPoint: '0'
  };

  try {
    const uploadAndDownloadContent: string = torrentPage('#usermsglink > span:nth-child(2)').text();
    const [ transh, uploadCount, downloadCount, shareRatio ] = uploadAndDownloadContent.match(/[^\d]*(\d*\.*\d*)[^\d]*(\d*\.*\d*)[^\d]*(\d*\.*\d*)/) || ['', '', ''];
    const magicPointContent: string = torrentPage('#userbarPanel > span:nth-child(7)').text();
    const [trash1, magicPoint] = magicPointContent.match(/(\d+)/)  || ['', ''];
    userInfo.shareRatio = shareRatio.replace(',', '');
    userInfo.magicPoint = magicPoint.replace(',', '').trim();
    userInfo.downloadCount = downloadCount.replace(',', '');
    userInfo.uploadCount = uploadCount.replace(',', '');
  } catch (e) {
    log.log(`[SITE] [SJTU] get user info: [${e.message}], [${e.stack}]`);
  }
  return userInfo;
}

export async function getFreeTime(el: cheerio.CheerioAPI, isFree: boolean): Promise<Date> {
  const freeEl = el('.torrentname .embedded font[style="color:#38ACEC"]');
  if (0 === freeEl.length) {
    if (false === isFree) {
      return null;
    } else {
      return new Date('2030-01-01')
    }
  }

  const timeString: string = freeEl.attr('title');
  return utils.parseCSTDate(timeString);
}

export async function getFreeTime2up(el: cheerio.CheerioAPI, isFree: boolean): Promise<Date> {
  const freeEl = el('.torrentname .embedded > b:nth-child(5) font');
  if (0 === freeEl.length) {
    if (false === isFree) {
      return null;
    } else {
      return new Date('2030-01-01')
    }
  }

  const timeString: string = freeEl.attr('title');
  return utils.parseCSTDate(timeString);
}

export async function getSiteId(el: cheerio.CheerioAPI, torrentUrl): Promise<string> {
  const idHref: string= el('.download').parent().attr('href');
  const hrefItem = urlLib.parse(idHref, true);
  return hrefItem.query.id as string;
}

export async function getTitle(el: cheerio.CheerioAPI): Promise<string> {
  const titleEl = el('.embedded a b');
  if (null === titleEl) {
    return '';
  } 
  const title: any = titleEl.text();
  return title;
}

export async function getSize(el: cheerio.CheerioAPI): Promise<number> {
  try {
    const sizeString = el('td:nth-child(5)').text();
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
  const peerActive = el('.peer-active');
  return 0 < peerActive.length;
}

export async function publishDate(el: cheerio.CheerioAPI): Promise<Date> {
  const dateString: string = el('td:nth-child(4) span').attr('title');
  return utils.parseCSTDate(dateString);
}

export async function isSticky(el: cheerio.CheerioAPI): Promise<boolean> {
  const stickyFlag = el('.embedded > img');
  return 0 < stickyFlag.length;
}

export async function checkFreeItem(el: cheerio.CheerioAPI): Promise<boolean> {
  const { siteAnchor } = config.getConfig();
  console.log(el().html());
  return 0 < el(siteAnchor.freeItem1up).length;
}
