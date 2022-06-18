
import * as log from './log';
import * as config from './config';

import * as puppeLite from './puppe-lite';
import * as puppeteer from './puppeteer';
import { TPageUserInfo } from './sites/basic';
import { TItem } from './types';

const puppeMap = {
  'hdchina': puppeteer,
  'hdtime': puppeLite,
  'mteam': puppeLite,
  'sjtu': puppeLite,
  'audiences': puppeLite,
  'ourbits': puppeLite
};

export async function init(): Promise<void> {
  await puppeMap[config.site].init();
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
  return await puppeMap[config.site].filterVIPItem(url);
}

export async function filterFreeItem(url: string): Promise<TItem[]> {
  return await puppeMap[config.site].filterFreeItem(url);
}
