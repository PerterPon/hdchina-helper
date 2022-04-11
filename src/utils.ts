
import * as moment from 'moment';
import * as config from './config';
import axios, { AxiosResponse } from 'axios';
import * as fs from 'fs';
import * as qs from 'qs';

let currentCsrfToken: string = null;
let currentPhpSessionId: string = null;

export function sleep(time: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, time);
  });
}

export function displayTime(): string {
  return moment().format('YYYY-MM-DD HH:mm:SS');
}

export async function fetchCsrfTokenAndPHPSessionId(): Promise<{csrfToken: string; phpSessionId: string;}> {
  if (null !== currentCsrfToken && null !== currentPhpSessionId) {
    return {
      csrfToken: currentCsrfToken,
      phpSessionId: currentPhpSessionId
    };
  }
  console.log(`[${displayTime()}] fetch csrf token`);
  const configInfo = config.getConfig();
  const { cookie, indexPage } = configInfo.hdchina;
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

  console.log(`[${displayTime()}] got token: [${csrfToken}], php session id: [${phpSessionId}]`);
  return {
    csrfToken,
    phpSessionId
  };
}

export async function getItemDetailByIds(ids: string[]): Promise<any> {
  console.log(`[${displayTime()}] [Utils], getItemDetailByIds: [${ids}]`);
  const configInfo = config.getConfig();
  const { cookie, checkFreeUrl } = configInfo.hdchina;
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

export const ajaxHeader = {
  "accept": "*/*",
  "accept-language": "zh-CN,zh;q=0.9,en;q=0.8,ja;q=0.7,zh-TW;q=0.6",
  "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
  "sec-ch-ua": "\" Not A;Brand\";v=\"99\", \"Chromium\";v=\"99\", \"Google Chrome\";v=\"99\"",
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