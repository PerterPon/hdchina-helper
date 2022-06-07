
import axios from 'axios';
import * as moment from 'moment';

import * as config from './config';
import * as log from './log';
import * as oss from './oss';
import * as utils from './utils';

export async function init(): Promise<void> {

}


export async function sendMessage(): Promise<void> {
  const logFileName: string = `${utils.displayTime()}.log`
  await oss.uploadTorrent(`log/${logFileName}`, Buffer.from(log.logs.join('\n')));
  const configInfo = config.getConfig();
  const { cdnHost } = configInfo.aliOss;
  const logUrl: string = `http://${cdnHost}/hdchina/log/${logFileName}`;

  log.message(`[Util] detail log: [ ${logUrl} ]`);
  const { webhook } = configInfo.lark;
  await doSendMessage(webhook, log.messages.join('\n'));
}

export async function sendErrorMessage(): Promise<void> {
  const logFileName: string = `${utils.displayTime()}.log`
  await oss.uploadTorrent(`log/${logFileName}`, Buffer.from(log.logs.join('\n')));
  const configInfo = config.getConfig();
  const { cdnHost } = configInfo.aliOss;
  const logUrl: string = `http://${cdnHost}/hdchina/log/${logFileName}`;
  const { errorWebhook } = configInfo.lark;

  log.message(`[Util] detail log: [ ${logUrl} ]`);
  await doSendMessage(errorWebhook, log.messages.join('\n'));
}

async function doSendMessage(webhook: string, message: string): Promise<void> {
  log.log(`[MESSAGE] send message`);
  await axios({
    url: webhook,
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    data: {
      "msg_type": "text",
      "content": {
        "text": message
      }
    }
  });
}
