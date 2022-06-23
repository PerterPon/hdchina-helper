
const xmlLib = require('fast-xml-parser');
import * as urlLib from 'url';
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

  const res = await axios(url);
  const parser = new xmlLib.XMLParser({
    ignoreAttributes: false
  });
  const parsedContent = parser.parse(res.data);
  rssContent.set(url, parsedContent);
  return parsedContent;
}

export async function filterVIPItem(url: string): Promise<TItem[]> {
  const site = getCurrentSite();
  const rssLink = await site.getRssLink();
  url = rssLink;
  log.log(`[Puppe-rss] filterVIPItem, url: [${url}]`);
  const userInfo: TPTUserInfo = config.userInfo;
  const content = await loadPage(url);

  const { item: items } = content.rss.channel;

  const vipItems: TItem[] = [];

  for (const item of items) {
    const { title, link, pubDate, guid, enclosure } = item;
    const freeTime: Date = new Date('2033-01-01');
    const urlItem = urlLib.parse(link, true);
    vipItems.push({
      id: urlItem.query.id as string,
      uid: userInfo.uid,
      site: userInfo.site,
      free: true,
      freeUntil: freeTime,
      publishDate: new Date(pubDate),
      size: enclosure['@_length'],
      title,
      torrentUrl: enclosure['@_url'],
      transHash: guid['#text'],
      serverId: -1
    });
  }

  return vipItems;
}
