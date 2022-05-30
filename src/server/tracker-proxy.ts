
import * as utils from '../utils';
import * as url from 'url';
import axios from 'axios';
import * as stream from 'stream';
import * as http from 'http';
// import * as request from 'request';
import * as https from 'https';

const httpAgent = new http.Agent({ keepAlive: true });
const httpsAgent = new https.Agent({ keepAlive: true });

const instance = axios.create({
  httpAgent,  // httpAgent: httpAgent -> for non es6 syntax
  httpsAgent,
});

const agent = new http.Agent({
  keepAlive: true
});

const TARGET_HOST: string = 'tracker.m-team.cc';
const app = http.createServer(async (req, res) => {
  console.log(`[${utils.displayTime()}] new request [${req.url}], , headers: [${JSON.stringify(req.headers)}], method: [${req.method}]`);

  const urlItem = url.parse(req.url, true);
  urlItem.host = TARGET_HOST;
  urlItem.protocol = 'https:';
  const headers = req.headers as any;
  headers.host = TARGET_HOST;
  console.log(urlItem, urlItem.pathname);
  if ( '/announce.php' ===  urlItem.pathname) {
    urlItem.query.uploaded = increaseUpload(urlItem.query.uploaded as string);
  }
  console.log(urlItem);
  urlItem.query.uploaded = '12300';
  console.log(`request with: [${url.format({
    host: urlItem.host,
    protocol: urlItem.protocol,
    query: urlItem.query,
    pathname: urlItem.pathname
  })}], headers: [${JSON.stringify(headers)}]`);

  const resData = await axios({
    url: url.format(urlItem),
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

function increaseUpload(originUpload: string): string {
  return '133';
  const numUploaded: number = Number(originUpload);
  console.log(`increase upload, origin: [${originUpload}], increase: [${numUploaded * 1.11}]`);
  if (isNaN(numUploaded)) {
    return originUpload;
  }

  return String(numUploaded * 1.11);
}

app.listen(4230, () => {
  console.log(`listing port: [${4239}]`);
});