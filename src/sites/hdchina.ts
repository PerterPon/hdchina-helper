
import * as puppeteer from 'puppeteer';
import { TItem } from '../types';

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
    magicP = await torrentPage.$('.userinfo > p:nth-child(2)');
    const magicPointContent: string = await magicP.evaluate((el) => el.textContent) || '';
    const [magicPoint] = magicPointContent.match(/\d+\,\d+\.\d+/) || [];
    userInfo.magicPoint = magicPoint || '';
    userInfo.magicPoint = userInfo.magicPoint.replace(/\,/g, '');
  } catch (e) {}
  try {
    ratioP = await torrentPage.$('.userinfo > p:nth-child(3)');
    const ratioContent: string = await ratioP.evaluate((el) => el.textContent) || '';
    const [shareRatio, uploadCount, downloadCount] = ratioContent.match(/\d+\.\d+/g) || [];
    userInfo.shareRatio = shareRatio;
    userInfo.uploadCount = uploadCount;
    userInfo.downloadCount = downloadCount;
  } catch (e) {}
  return userInfo;
}

export async function getFreeTime(el: puppeteer.ElementHandle): Promise<string> {
  return await el.$eval('.pro_free', (el) => el.getAttribute('onmouseover'));
}

export async function getFreeTime2up(el: puppeteer.ElementHandle): Promise<string> {
  return await el.$eval('.pro_free2up', (el) => el.getAttribute('onmouseover'));
}

export async function getSiteId(el: puppeteer.ElementHandle): Promise<string> {
  const idHref = await el.$eval('h3 a', (el) => el.getAttribute('href'));
  const [trash, id] = idHref.match(/id=(\d+)&/);
  return id;
}

export async function getTitle(el: puppeteer.ElementHandle): Promise<string> {
  const title: any = await el.$eval('h3 a', (el) => el.getAttribute('title'));
  return title;
}

export async function getSize(el: puppeteer.ElementHandle): Promise<number> {
  const sizeString: string = await el.$eval('.t_size', (el) => el.innerHTML);
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
