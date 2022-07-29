
import * as log from './log';
import * as config from './config';

import * as puppeLite from './puppe-lite';
import * as puppeteer from './puppeteer';
import * as puppeRss from './puppe-rss';
import { TPageUserInfo } from './sites/basic';
import { TItem, TPTUserInfo } from './types';

const puppeMap = {
  'hdchina': puppeteer,
  'hdtime': puppeLite,
  'mteam': puppeLite,
  'sjtu': puppeLite,
  'audiences': puppeLite,
  'ourbits': puppeLite,
  'pterclub': puppeLite,
  'pttime': puppeLite,
  'hdarea': puppeLite,
  'discfan': puppeLite,
  'piggo': puppeLite,
  'ptsbao': puppeLite,
  'hdsky': puppeLite,
  'lemonhd': puppeLite,
  'chdbits': puppeLite,
  'nicept': puppeLite
};

const rssMap = {
  'mteam': puppeRss,
  'piggo': puppeRss,
  'lemonhd': puppeRss
};

export async function init(): Promise<void> {
  await puppeMap[config.site].init(config.site);
}

export async function loadPage(url: string): Promise<any> {
  const page = await puppeMap[config.site].loadPage(url);
  return page;
}

export async function getUserInfo(url: string): Promise<TPageUserInfo> {
  const userInfo: TPageUserInfo = await puppeMap[config.site].getUserInfo(url);
  return userInfo;
}

export async function filterVIPItem(url: string): Promise<TItem[]> {
  const userInfo: TPTUserInfo = config.userInfo;
  const { vip, rss } = userInfo;
  const rssMethod = rssMap[config.site];
  if (true === rss && undefined !== rssMethod) {
    return await rssMethod.filterRssItem(url);
  } else {
    return await puppeMap[config.site].filterVIPItem(url);
  }
}

export async function filterFreeItem(url: string): Promise<TItem[]> {
  const userInfo: TPTUserInfo = config.userInfo;
  const { vip, rss } = userInfo;
  const rssMethod = rssMap[config.site];
  if (true === rss && undefined !== rssMethod) {
    return rssMethod.filterRssItem(url);
  } else {
    return await puppeMap[config.site].filterFreeItem(url);
  }
}

export async function flushCache(): Promise<void> {
  puppeLite.flushCache();
  puppeRss.flushCache();
  puppeteer.flushCache();
}
