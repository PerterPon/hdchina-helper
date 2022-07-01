
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
    const magicPointContent: string = torrentPage('#info_block').text();
    const [trash1, magicPoint] = magicPointContent.match(/魔力值\s*\[使用\]\:\s(.*)\s\[签到/)  || ['', ''];
    const [trash2, shareRatio] = magicPointContent.match(/分享率： (\d*\.*\d*)\s*/) || ['', ''];
    const [trash3, uploadCount] = magicPointContent.match(/上传量： (.*)\s下/)  || ['', ''];
    const [trash4, downloadCount] = magicPointContent.match(/下载量： (.*)当前活动/)  || ['', ''];
    let uploadNumberCount = 0;
    let downloadNumberCount = 0;
    if (-1 < uploadCount.indexOf('GB')) {
      uploadNumberCount = Number(uploadCount.replace('GB', '')) / 1000;
    } else if (-1 < uploadCount.indexOf('TB')) {
      uploadNumberCount = Number(uploadCount.replace('TB', ''));
    } else if (-1 < uploadCount.indexOf('MB')) {
      uploadNumberCount = Number(uploadCount.replace('KB', '')) / 1000 / 1000;
    } else if (-1 < uploadCount.indexOf('KB')) {
      uploadNumberCount = Number(uploadCount.replace('KB', '')) / 1000 / 1000 / 1000;
    }
    if (-1 < downloadCount.indexOf('GB')) {
      downloadNumberCount = Number(downloadCount.replace('GB', '')) / 1000;
    } else if (-1 < downloadCount.indexOf('TB')) {
      downloadNumberCount = Number(downloadCount.replace('TB', ''));
    } else if (-1 < downloadCount.indexOf('MB')) {
      downloadNumberCount = Number(downloadCount.replace('TB', '')) / 1000 / 1000;
    } else if (-1 < downloadCount.indexOf('KB')) {
      downloadNumberCount = Number(downloadCount.replace('TB', '')) / 1000 / 1000 / 1000;
    }
    userInfo.shareRatio = shareRatio.replace(',', '');
    userInfo.magicPoint = magicPoint.replace(',', '').trim();
    userInfo.downloadCount = downloadNumberCount.toFixed(3);
    userInfo.uploadCount = uploadNumberCount.toFixed(3);

    const nickAndUid = utils.fetchNicknameAndUidFromPage(torrentPage, '#info_block .bottom a');
    Object.assign(userInfo, nickAndUid);
  } catch (e) {
    log.log(`[SITE] [HDTIME] get user info: [${e.message}], [${e.stack}]`);
  }
  return userInfo;
}

export async function getFreeTime(el: cheerio.CheerioAPI): Promise<Date> {
  const freeEl = el('.pro_free');
  if (0 === freeEl.length) {
    return null;
  }

  const freeTimeContainer: string = freeEl.attr('onmouseover');
  if (!freeTimeContainer) {
    return new Date('2023-01-01');
  } else {
    const [timeString] = freeTimeContainer.match(/\d\d\d\d-\d\d-\d\d\s\d\d:\d\d:\d\d/);
    return utils.parseCSTDate(timeString);
  }
}

export async function getFreeTime2up(el: cheerio.CheerioAPI): Promise<Date> {
  const freeEl = el('.pro_free2up');
  if (0 === freeEl.length) {
    return null;
  }

  const freeTimeContainer: string = freeEl.attr('onmouseover');
  if (!freeTimeContainer) {
    return new Date('2023-01-01');
  } else {
    const [timeString] = freeTimeContainer.match(/\d\d\d\d-\d\d-\d\d\s\d\d:\d\d:\d\d/);
    return utils.parseCSTDate(timeString);
  }
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
  const stickyFlag = el('.sticky');
  return 0 < stickyFlag.length;
}

export async function checkFreeItem(el: cheerio.CheerioAPI): Promise<boolean> {
  const { siteAnchor } = config.getConfig();
  let freeItem = el(siteAnchor.freeItem1up);
  if (0 === freeItem.length) {
    freeItem = el(siteAnchor.freeItem2up);
  }

  return 0 !== freeItem.length;
}
