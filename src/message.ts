
import axios from 'axios';
import * as moment from 'moment';

import * as config from './config';
import * as log from './log';
import * as oss from './oss';

export async function init(): Promise<void> {

}


export async function sendMessage(): Promise<void> {
  const logFileName: string = `${moment().format('YYYY-MM-DD_HH:mm:SS')}.log`
  await oss.uploadTorrent(`log/${logFileName}`, Buffer.from(log.logs.join('\n')));
  const configInfo = config.getConfig();
  const { cdnHost } = configInfo.hdchina.aliOss;
  const logUrl: string = `http://${cdnHost}/hdchina/log/${logFileName}`;

  log.message(`[Util] detail log: [ ${logUrl} ]`);
  await doSendMessage(log.messages.join('\n'));
}

async function doSendMessage(message: string): Promise<void> {
  log.log(`[MESSAGE] send message`);
  const configInfo = config.getConfig();
  const { webhook } = configInfo.hdchina.lark;
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
