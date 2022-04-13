
import * as OSS from 'ali-oss';
import * as config from './config';
import { displayTime } from './utils';
import * as log from './log';

let store: OSS = null;

export async function init(): Promise<void> {
  const configInfo = config.getConfig();
  const { accessKeyId, accessKeySecret, bucket, endpoint } = configInfo.hdchina.aliOss;
  store = new OSS({
    accessKeyId,accessKeySecret,bucket,endpoint
  });
  
}

export async function uploadFile(name: string, filePath: string|Buffer): Promise<void> {
  log.log(`[${displayTime()}] [OSS] put file: [${name}], file path: [${filePath}]`);
  const res: OSS.PutObjectResult = await store.put(`hdchina/${name}`, filePath);
  log.log(`[${displayTime()}] [OSS] put file with result: [${JSON.stringify(res)}]`);
}
