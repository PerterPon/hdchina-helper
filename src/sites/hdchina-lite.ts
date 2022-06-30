
import * as moment from 'moment';
import * as cheerio from 'cheerio';
import * as puppeteer from 'puppeteer';
import { TItem, TPTUserInfo } from '../types';
import * as utils from '../utils';
import * as log from '../log';
import * as config from '../config';
import * as mysql from '../mysql';
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
    const magicPointContent: string = torrentPage('.userinfo > p:nth-child(2)').text();
    const [magicPoint] = magicPointContent.match(/\d+\,\d+\.\d+/) || [];
    userInfo.magicPoint = magicPoint || '';
    userInfo.magicPoint = userInfo.magicPoint.replace(/\,/g, '');
    const ratioContent: string = torrentPage('.userinfo > p:nth-child(3)').text();
    const [shareRatio, uploadCount, downloadCount] = ratioContent.match(/\d+\.\d+/g) || [];
    userInfo.shareRatio = shareRatio;
    userInfo.uploadCount = uploadCount;
    userInfo.downloadCount = downloadCount;

    const nickAndUid = utils.fetchNicknameAndUidFromPage(torrentPage, '.userinfo p:nth-child(2) span a');
    Object.assign(userInfo, nickAndUid);
  } catch (e) {
    log.log(`[SITE] [hdchina] get user info: [${e.message}], [${e.stack}]`);
  }
  return userInfo;
}

export async function getFreeTime(el: cheerio.CheerioAPI): Promise<Date> {
  const freeTimeContainer: string =  el('.pro_free').attr('onmouseover');
  const [timeString] = freeTimeContainer.match(/\d\d\d\d-\d\d-\d\d\s\d\d:\d\d:\d\d/);
  return utils.parseCSTDate(timeString);
}

export async function getFreeTime2up(el: cheerio.CheerioAPI): Promise<Date> {
  const freeTimeContainer: string =  el('.pro_free2up').attr('onmouseover');
  const [timeString] = freeTimeContainer.match(/\d\d\d\d-\d\d-\d\d\s\d\d:\d\d:\d\d/);
  return utils.parseCSTDate(timeString);
}

export async function getSiteId(el: cheerio.CheerioAPI, torrentUrl): Promise<string> {
  const idHref = await el('h3 a').attr('href');
  const [trash, id] = idHref.match(/id=(\d+)&/);
  return id;
}

export async function getTitle(el: cheerio.CheerioAPI): Promise<string> {
  const title: any = await el('h3 a').attr('title');
  return title;
}

export async function getSize(el: cheerio.CheerioAPI): Promise<number> {
  const sizeString: string = el('.t_size').html();
  const [ sizeNumberString ] = sizeString.match(/\d+/);
  const sizeNumber: number = Number(sizeNumberString)
  let size: number = 0;
  if (-1 < sizeString.indexOf('GB')) {
    size = sizeNumber * 1024 * 1024 * 1024
  } else if (-1 < sizeString.indexOf('MB')) {
    size = sizeNumber * 1024 * 1024;
  }
  return size;
}

export async function getDownloadUrl(item: TItem): Promise<string> {
  return `${item.torrentUrl}&uid=${item.uid}`;
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
  const progress = el('.progressarea');
  return 0 !== progress.length;
}

export async function publishDate(el: cheerio.CheerioAPI): Promise<Date> {
  const dateString: string = await el('td:nth-child(4) span').attr('title');
  return utils.parseCSTDate(dateString);
}

export async function isSticky(el: cheerio.CheerioAPI): Promise<boolean> {
  const stickyFlag = el('.sticky');
  return 0 !== stickyFlag.length;
}

export async function checkFreeItem(el: cheerio.CheerioAPI): Promise<boolean> {
  const { siteAnchor } = config.getConfig();
  let freeItem = el(siteAnchor.freeItem1up);
  if (null === freeItem) {
    freeItem = el(siteAnchor.freeItem2up);
  }

  return null !== freeItem;
}
