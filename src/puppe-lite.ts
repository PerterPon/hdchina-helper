
import * as cheerio from 'cheerio';
import axios, { AxiosResponseHeaders } from 'axios';
import * as filesize from 'filesize';
import * as _ from 'lodash';

import * as log from './log';
import * as config from './config';
import * as mysql from './mysql';

import * as utils from './utils';

import { siteMap, TPageUserInfo, getCurrentSite } from './sites/basic';
import { TItem, TPTUserInfo } from './types';

const pageMap: Map<string, cheerio.CheerioAPI> = new Map();
const pageResHeaders: Map<string, AxiosResponseHeaders> = new Map();

let currentSite = null

export async function init(): Promise<void> {
  log.log(`[Puppe-lite] init`);
  currentSite = getCurrentSite();
}

export async function loadPage(url: string): Promise<cheerio.CheerioAPI> {
  log.log(`[Puppe-lite] loadPage, url: [${url}]`);
  let page: cheerio.CheerioAPI = pageMap.get(url);
  if (undefined === page) {
    const userInfo: TPTUserInfo = await mysql.getUserInfoByQuery({
      nickname: config.nickname,
      site: config.site
    });
    const { cookie } = userInfo;
    const pageRes = await axios.get(url, {
      headers: {
        ...utils.htmlHeader,
        cookie
      }
    });
    const pageContent: string = pageRes.data;

    page = cheerio.load(pageContent);
    pageMap.set(url, page);
    pageResHeaders.set(url, pageRes.headers);
  }
  return page;
}

export async function getUserInfo(url: string): Promise<TPageUserInfo> {
  log.log(`[Puppe-lite] get user info`);
  const page: cheerio.CheerioAPI = await loadPage(url);
  const userInfo: TPageUserInfo = await currentSite.getUserInfo(page);
  return userInfo;
}

export async function filterVIPItem(url: string): Promise<TItem[]> {
  log.log(`[Puppe-lite] filterVIPItem with url: [${url}]`);
  const freeItems: TItem[] = [];
  const configInfo = config.getConfig();
  const page: cheerio.CheerioAPI = await loadPage(url);

  const { siteAnchor } = configInfo;
  let torrentItems: cheerio.Cheerio<any> = page(siteAnchor.torrentItem);

  const stickyItems: TItem[] = [];
  torrentItems = torrentItems.slice(1);
  for(const item of torrentItems) {
    const $item = cheerio.load(item);
    let freeTime: Date = utils.parseCSTDate('2030-01-01');
    console.log(await currentSite.getFreeTime($item));

    const torrentAnchor: cheerio.Cheerio<any> = $item(siteAnchor.torrentUrlAnchor);
    let torrentUrl: string = torrentAnchor.parent().attr('href');
    torrentUrl = `${configInfo.domain}/${torrentUrl}`;

    const id: string = await currentSite.getSiteId($item, torrentUrl);
    const title: string = await currentSite.getTitle($item);
    const size: number = await currentSite.getSize($item);
    const publishDate: Date = await currentSite.publishDate($item);
    const isSticky: boolean = await currentSite.isSticky($item);

    log.log(`[Puppe-lite] scraping item: [${title}], size: [${filesize(size)}], publish date: [${publishDate}]`);
    if (true === isSticky) {
      stickyItems.push({
        id, title, size, publishDate,
        freeUntil: freeTime,
        free: true,
        uid: config.uid,
        torrentUrl: torrentUrl,
        site: config.site,
        serverId: -1
      });
    } else {
      freeItems.push({
        id, title, size, publishDate,
        freeUntil: freeTime,
        free: true,
        uid: config.uid,
        torrentUrl: torrentUrl,
        site: config.site,
        serverId: -1
      });
    }
  }

  const dateSortedItems: TItem[] = _.sortBy(freeItems, 'publishDate').reverse();
  const { vipNormalItemCount } = config.userInfo;
  const latestItems: TItem[] = dateSortedItems.slice(0, vipNormalItemCount);
  const vipItems = latestItems.concat(stickyItems);
  return vipItems;
}

export async function filterFreeItem(url: string): Promise<TItem[]> {
  log.log(`[Puppe-lite] filterFreeItem url: [${url}]`);
  const freeItems: TItem[] = [];
  const configInfo = config.getConfig();
  const { globalRetryTime, uid } = configInfo;
  const page: cheerio.CheerioAPI = await loadPage(url);

  const { siteAnchor } = configInfo;
  let torrentItems: cheerio.Cheerio<any> = page(siteAnchor.torrentItem);
  let freeTarget = [];

  try {
    try {
      const freeTarget1up = page(siteAnchor.freeItem1upTag);
      freeTarget = freeTarget.concat(freeTarget1up);
    } catch (e) {}
    try {
      const freeTarget2up = page(siteAnchor.freeItem2upTag);
      freeTarget = freeTarget.concat(freeTarget2up);
    } catch (e) {}
    log.log(`[Puppe-lite] free target count: [${freeTarget.length}]`);
  } catch (e) {
    log.log(`[Puppe-lite] failed to launch page with error: [${e.message}], wait for retry`);
  }

  // the first one is title
  torrentItems = torrentItems.slice(1);
  for(const item of torrentItems) {
    const $item = cheerio.load(item);
    let freeItem = null;
    let isFree: boolean = false;
    freeItem = $item(siteAnchor.freeItem1up);
    if (0 === freeItem.length) {
      freeItem = $item(siteAnchor.freeItem2up);
    }

    const title: string = await currentSite.getTitle($item);
    const size: number = await currentSite.getSize($item);
    const publishDate: Date = await currentSite.publishDate($item);
    const downloaded: boolean = await currentSite.isDownloaded($item);
    log.log(`[Puppe-lite] scraping item: [${title}] downloaded: [${downloaded}], size: [${filesize(size)}], publish date: [${publishDate}]`);

    let freeTime: Date = null;
    if( 0 === freeItem.length ) {
      log.log(`[Puppe-lite] free Item === null: [${0 === freeItem.length}] downloaded: [${downloaded}]`);
      isFree = false;
    } else {
      isFree = true;
      try {
        freeTime = await currentSite.getFreeTime($item);
      } catch (e) {
        log.log(e.message, e.stack);
      }
      try {
        if (null === freeTime) {
          freeTime = await currentSite.getFreeTime2up($item);
        }
      } catch (e) {
        log.log(e.message, e.stack);
      }
    }

    const torrentAnchor: cheerio.Cheerio<any> = $item(siteAnchor.torrentUrlAnchor);
    let torrentUrl: string = torrentAnchor.parent().attr('href');
    torrentUrl = `${configInfo.domain}/${torrentUrl}`;
    const id: string = await currentSite.getSiteId($item, torrentUrl);

    freeItems.push({
      id, title, size, publishDate,
      freeUntil: freeTime,
      free: isFree,
      uid: config.uid,
      torrentUrl: torrentUrl,
      site: config.site,
      serverId: -1
    });
  }
  return freeItems;
}

export async function getCsrfToken(): Promise<string> {
  log.log(`[Puppe-lite] getCsrfToken`);
  const configInfo = config.getConfig();
  const pageInfo = await loadPage(configInfo.torrentPage[0]);
  const html: string = pageInfo.html();
  return utils.fetchCsrfTokenFromHtml(html);
}

export async function getPHPSessionId(): Promise<string> {
  log.log(`[Puppe-lite] getPHPSessionId`);
  const configInfo = config.getConfig();
  await loadPage(configInfo.torrentPage[0]);
  const headers = pageResHeaders.get(configInfo.torrentPage[0]);
  const phpSessionIdCookie: string = (headers['set-cookie'] || [])[0] || '';
  const [phpSessionId] = phpSessionIdCookie.split(';');
  return phpSessionId;
}
