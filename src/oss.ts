
import * as OSS from 'ali-oss';
import * as path from 'path';
import * as config from './config';
import * as log from './log';

let store: OSS = null;

export async function init(): Promise<void> {
  log.log(`[OSS] init`);
  if (null !== store) {
    return null;
  }
  const configInfo = config.getConfig();
  const { accessKeyId, accessKeySecret, bucket, endpoint } = configInfo.aliOss;
  store = new OSS({
    accessKeyId,accessKeySecret,bucket,endpoint
  });
  
}

export async function uploadTorrent(site: string, uid: string, siteId: string, filePath: string|Buffer): Promise<string> {
  log.log(`[OSS] put file, site: [${site}], uid: [${uid}], siteId:[${siteId}]`);
  const res: OSS.PutObjectResult = await store.put(`${site}/${uid}/${siteId}`, filePath);
  const configInfo = config.getConfig();
  const { cdnHost } = configInfo.aliOss;
  log.log(`[OSS] put file with result: [${JSON.stringify(res)}]`);
  return path.join(cdnHost, site, uid, siteId);
}

export async function uploadScreenShot(name: string, filePath: string|Buffer): Promise<void> {
  log.log(`[OSS] put file: [${name}]`);
  const res: OSS.PutObjectResult = await store.put(`screenshot/${name}`, filePath);
  log.log(`[OSS] put file with result: [${JSON.stringify(res)}]`);
}
