
import * as OSS from 'ali-oss';
import * as config from './config';
import * as log from './log';

let store: OSS = null;

export async function init(): Promise<void> {
  const configInfo = config.getConfig();
  const { accessKeyId, accessKeySecret, bucket, endpoint } = configInfo.aliOss;
  store = new OSS({
    accessKeyId,accessKeySecret,bucket,endpoint
  });
  
}

export async function uploadTorrent(name: string, filePath: string|Buffer): Promise<void> {
  log.log(`[OSS] put file: [${name}]`);
  const res: OSS.PutObjectResult = await store.put(`hdchina/${name}`, filePath);
  log.log(`[OSS] put file with result: [${JSON.stringify(res)}]`);
}

export async function uploadScreenShot(name: string, filePath: string|Buffer): Promise<void> {
  log.log(`[OSS] put file: [${name}]`);
  const res: OSS.PutObjectResult = await store.put(`screenshot/${name}`, filePath);
  log.log(`[OSS] put file with result: [${JSON.stringify(res)}]`);
}
