
const xmlLib = require('fast-xml-parser');
import * as urlLib from 'url';
import * as puppeteer from 'puppeteer';
import axios from 'axios';
import { TItem, TPTUserInfo } from './types';
import * as config from './config';
import * as utils from './utils';
import * as log from './log';

import { getCurrentSite } from './sites/basic';

const rssContent: Map<string, any> = new Map();

export async function init(): Promise<void> {
  
}

export async function loadPage(url: string): Promise<any> {
  const content = rssContent.get(url);
  if (undefined !== content) {
    return content;
  }

  // const browser = await puppeteer.launch({
  //   headless: false,
  //   executablePath: null,
  //   ignoreDefaultArgs: [],
  // });

  // const page = await browser.newPage();
  // await page.goto(url);
  // await utils.sleep(10 * 1000);
  // const xmlContent = await page.content();
  // page.on('response', async (e) => {
  //   console.log(await e.text());
  // });

  const res = await axios(url);
  const xmlContent = res.data;

  const parser = new xmlLib.XMLParser({
    ignoreAttributes: false
  });
  const parsedContent = parser.parse(xmlContent);
  rssContent.set(url, parsedContent);
  return parsedContent;
}

export async function filterRssItem(url: string): Promise<TItem[]> {
  const site = getCurrentSite();
  const rssLink = await site.getRssLink();
  url = rssLink;
  log.log(`[Puppe-rss] filterRssItem, url: [${url}]`);
  const userInfo: TPTUserInfo = config.userInfo;
  const content = await loadPage(url);

  const { item: items } = content.rss.channel;

  const vipItems: TItem[] = site.getRssItem(items, userInfo);

  return vipItems;
}

export async function flushCache(): Promise<void> {
  rssContent.clear();
}
