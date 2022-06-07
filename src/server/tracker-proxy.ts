
import * as utils from '../utils';
import * as url from 'url';
import axios from 'axios';
import * as stream from 'stream';
import * as http from 'http';
// import * as request from 'request';
import * as https from 'https';
import * as config from '../config';
import * as mysql from '../mysql';
import { TPTUserInfo } from 'src/types';

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

const siteTrackerMap = {
  'hdtime': 'tracker.hdtime.org',
  'mteam': 'tracker.m-team.cc',
  'hdchina': 'tracker.hdchina.org'
};

const app = http.createServer(async (req, res) => {
  console.log(`[${utils.displayTime()}] new request [${req.url}], , headers: [${JSON.stringify(req.headers)}], method: [${req.method}]`);

  const userInfo: TPTUserInfo = await getUserInfo(req.url);
  const host: string = await getHostByUrl(userInfo);

  const urlItem = url.parse(req.url);
  urlItem.host = host;
  urlItem.protocol = 'https:';
  const headers = req.headers as any;
  headers.host = host;
  let proxyedUrl = `https://${host}${req.url}`;
  if ( '/announce.php' ===  urlItem.pathname) {
    const [trash, uploadedCount] = urlItem.query.match(/uploaded=(\d+)/) || [];
    const increasedCount = increaseUpload(uploadedCount, userInfo.increaseRate);
    proxyedUrl = proxyedUrl.replace(uploadedCount, increasedCount);
  }
  console.log(`request with: [${proxyedUrl}], headers: [${JSON.stringify(headers)}]`);

  const resData = await axios({
    url: proxyedUrl,
    headers,
    responseType: 'arraybuffer',
    httpAgent,
    httpsAgent
  });

  const originResHeaders = res.getHeaders();
  for (const headerName in originResHeaders) {
    res.removeHeader(headerName);
  }

  for (const headerName in resData.headers) {
    const headerValue = resData.headers[headerName];
    res.setHeader(headerName, headerValue);
  }

  console.log(`response code: [${resData.status}], data: [${resData.data}]`);
  res.statusCode = resData.status;
  res.end(resData.data);
});

async function getHostByUrl(userInfo: TPTUserInfo): Promise<string> {
  const { site } = userInfo;
  return siteTrackerMap[site];
}

async function getUserInfo(reqUrl): Promise<TPTUserInfo> {
  const urlItem = url.parse(reqUrl, true);
  const { passkey, uid, authkey, __uid } = urlItem.query;
  const userQuery = {} as any;
  if (__uid) {
    userQuery.uid = __uid;
  } else if (passkey) {
    userQuery.rss_passkey = passkey;
  } else if (uid) {
    userQuery.uid = uid;
  } else if (authkey) {
    userQuery.authkey = authkey;
  }

  const userInfo: TPTUserInfo = await mysql.getUserInfoByQuery(userQuery);
  return userInfo;
}

function increaseUpload(originUpload: string, increaseRate: number = 1): string {
  const numUploaded: number = Number(originUpload);
  const increasedCount: number = Math.round(numUploaded * increaseRate);
  console.log(`[!!!]increase upload, origin: [${originUpload}], increase: [${increasedCount}], increase rate: [${increaseRate}]`);
  if (isNaN(numUploaded)) {
    return originUpload;
  }

  return String(increasedCount);
}

app.listen(4230, async () => {
  console.log(`tracker listing port: [${4239}]`);
  await config.init();
  await mysql.init();
});
