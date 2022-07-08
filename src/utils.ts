
import * as moment from 'moment-timezone';
import * as puppeteer from 'puppeteer';
import axios, { AxiosResponse } from 'axios';
import * as fs from 'fs';
import * as qs from 'qs';
import * as Cheerio from 'cheerio';
import * as urlLib from 'url';

import * as config from './config';
import * as log from './log';
import { TNetUsage, TPTUserInfo } from './types';
import * as path from 'path';

let currentCsrfToken: string = null;
let currentPhpSessionId: string = null;
const CRONTAB_FILE: string = `/etc/crontab`;

export function sleep(time: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, time);
  });
}

export function displayTime(): string {
  return moment().tz('Asia/Shanghai').format('YYYY-MM-DD_HH:mm:ss');
}

export function parseCSTDate(dateString: string): Date {
  return moment(dateString).utcOffset(480, true).toDate();
}

export async function fetchCsrfTokenAndPHPSessionId(): Promise<{csrfToken: string; phpSessionId: string;}> {
  if (null !== currentCsrfToken && null !== currentPhpSessionId) {
    return {
      csrfToken: currentCsrfToken,
      phpSessionId: currentPhpSessionId
    };
  }
  log.log(`fetch csrf token`);
  const configInfo = config.getConfig();
  const { cookie, indexPage } = configInfo;
  const res: AxiosResponse = await axios.get(indexPage, {
    headers: {
      ...htmlHeader,
      cookie
    }
  });
  const html: string = res.data;
  const [_, csrfToken] = html.match(/name="x-csrf"\scontent="(.*)"/);
  currentCsrfToken = csrfToken;
  
  const phpSessionIdCookie: string = (res.headers['set-cookie'] || [])[0] || '';
  const [phpSessionId] = phpSessionIdCookie.split(';');
  currentPhpSessionId = phpSessionId;

  log.log(`got token: [${csrfToken}], php session id: [${phpSessionId}]`);
  return {
    csrfToken,
    phpSessionId
  };
}

export function fetchCsrfTokenFromHtml(html: string): string {
  const [_, csrfToken] = html.match(/name="x-csrf"\scontent="(.*)"/);
  return csrfToken;
}

export function UTF8Time(): Date {
  return moment().tz('Asia/Shanghai').toDate();
}

export async function getItemDetailByIds(ids: string[]): Promise<any> {
  log.log(`[Utils], getItemDetailByIds: [${ids}]`);

  const configInfo = config.getConfig();
  const { cookie, checkFreeUrl } = configInfo;
  const { csrfToken, phpSessionId } = await fetchCsrfTokenAndPHPSessionId();
  const res: AxiosResponse = await axios({
    method: 'post',
    url: checkFreeUrl,
    data: qs.stringify({
      ids,
      csrf: csrfToken
    }),
    headers: {
      ...ajaxHeader,
      "cookie": `${cookie}; ${phpSessionId}`,
    },
    responseType: 'json'
  });
  return res.data;
}

export async function writeFile(from: fs.ReadStream, to: fs.WriteStream): Promise<void> {
  from.pipe(to);
  return new Promise((resolve, reject) => {
    to.on('finish', resolve);
    to.on('error', reject);
  });
}

export function randomInt(input: number): number {
  return Math.round(
    Math.random() * input
  );
}

export async function getUserCookie(uid): Promise<puppeteer.SetCookie[]> {
  const configInfo = config.getConfig();
  const userInfo: TPTUserInfo = config.userInfo;
  const { cookie } = userInfo;
  const cookieItems: string[] = cookie.split(';');
  const cookies: puppeteer.SetCookie[] = [];
  const { domain } = configInfo.puppeteer.cookie;
  for (const item of cookieItems) {
    if ('' === item.trim()) {
      continue;
    }
    const [name, value] = item.split('=');
    cookies.push({
      name: name.trim(),
      value: value.trim(),
      domain: domain
    });
  }
  return cookies;
}

export async function parseCrontab(): Promise<string[]> {
  const content: string = fs.readFileSync(CRONTAB_FILE, 'utf-8');
  return content.split('\n');
}

export async function setCrontab(crontabs: string[]): Promise<string> {
  const content = crontabs.join('\n');
  fs.writeFileSync(CRONTAB_FILE, content);
  return content;
}

export function getVersion(): string {
  const versionFile: string = path.join(__dirname, '../version');
  return fs.readFileSync(versionFile, 'utf-8');
}

export function parseProcNet(): TNetUsage {
  const result: {[name: string]: TNetUsage} = {};
  if (false === fs.existsSync('/proc/net/dev')) {
    return {
      receive: 0,
      send: 0
    };
  }
  const content: string = fs.readFileSync('/proc/net/dev', 'utf-8');
  const items = content.split('\n');
  let maxReceive = 0;
  let maxSend = 0;
  for (const item of items) {
    const [ name, valueItem ] = item.split(':');
    if (undefined === valueItem) {
      continue;
    }

    const res = valueItem.match(/\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)\s*(\d+)/);
    const receive = Number(res[1]);
    const send = Number(res[9]);
    if (receive > maxReceive) {
      maxReceive = receive;
      maxSend = send;
    }
  }

  return {
    receive: maxReceive,
    send: maxSend
  }
}

export async function timeout<T>(input: Promise<T>, time: number, errorMessage: string): Promise<T> {
  let done: boolean = false;
  return new Promise(async (resolve, reject) => {
    setTimeout(() => {
      if (true === done) {
        return;
      }
      reject(new Error(errorMessage));
    }, time);
    let res: T = null;
    try {
      res = await input;
      done = true;
    } catch (e) {
      done = true;
      reject(e)
    }
    done = true;
    resolve(res);
  });
}

export function fetchNicknameAndUidFromPage(page: Cheerio.CheerioAPI, selector: string): {nickname: string; uid: string} {
  const nickA = page(selector);
  const $nickA = Cheerio.load(nickA[0]);
  const nickname = $nickA.text();
  const userInfoLink = $nickA('a').attr('href');
  const infoLinkQueryItem = urlLib.parse(userInfoLink, true);
  const uid = infoLinkQueryItem.query.id as string;
  return { nickname, uid };
}

export const ajaxHeader = {
  "accept": "*/*",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7,zh-TW;q=0.6",
  "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
  "sec-ch-ua": "\" Not A;Brand\";v=\"99\", \"Chromium\";v=\"100\", \"Google Chrome\";v=\"100\"",
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": "\"macOS\"",
  "sec-fetch-dest": "empty",
  "sec-fetch-mode": "cors",
  "sec-fetch-site": "same-origin",
  "x-requested-with": "XMLHttpRequest",
  "Referer": "https://hdchina.org/torrents.php",
  "Referrer-Policy": "strict-origin-when-cross-origin"
};

export const htmlHeader = {
  "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7,zh-TW;q=0.6",
  "cache-control": "max-age=0",
  "sec-ch-ua": "\" Not A;Brand\";v=\"99\", \"Chromium\";v=\"99\", \"Google Chrome\";v=\"99\"",
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": "\"macOS\"",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "same-origin",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1",
  "Referer": "https://hdchina.org/torrents.php",
  "Referrer-Policy": "strict-origin-when-cross-origin"
};

export const downloadHeader = {
  "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7,zh-TW;q=0.6",
  "sec-ch-ua": "\" Not A;Brand\";v=\"99\", \"Chromium\";v=\"100\", \"Google Chrome\";v=\"100\"",
  "sec-ch-ua-mobile": "?0",
  "sec-ch-ua-platform": "\"macOS\"",
  "sec-fetch-dest": "document",
  "sec-fetch-mode": "navigate",
  "sec-fetch-site": "none",
  "sec-fetch-user": "?1",
  "upgrade-insecure-requests": "1"
};
