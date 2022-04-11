
import axios from 'axios';
import * as config from './config';
import { displayTime } from './utils';

export async function init(): Promise<void> {

}


export async function sendMessage(message: string): Promise<void> {
  console.log(`[${displayTime()}] [MESSAGE] send message`);
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
