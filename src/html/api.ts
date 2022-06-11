
import { UTF8Time } from '../utils';
import * as mysql from '../mysql';
import * as moment from 'moment';
import { TPTServer, TPTUserInfo } from 'src/types';

export async function init(): Promise<void> {
  
}

export async function overviewInfo(): Promise<any> {
  
  const overViewData = await getDailyLoadData();
  const serverData = await getDailyServerData();
  return {
    overViewData, serverData
  }

}

export async function allUserInfo(params): Promise<any> {
  const users: TPTUserInfo[] = await mysql.getAllUser();
  const resData: any[] = [];
  for (const user of users) {
    const firstSiteData = await mysql.getFirstSiteData(user.uid, user.site);
    const latestSiteDate = await mysql.getLatestSiteData(user.uid, user.site);
    const totalUpload: number = latestSiteDate.uploadCount - firstSiteData.uploadCount;
    const userItem: any = Object.assign({}, user, {totalUpload});

    const dailyUserDownloadData = await getDailyLoadData(user.uid);
    const dailySiteData = await getDailySiteData(user.uid);
    userItem.loadData = dailyUserDownloadData;
    userItem.serverData = dailySiteData;
    resData.push(userItem);
  }

  return resData;
}

export async function userLog(params): Promise<any> {
  const { uid, site } = params;
  const data = await getDailyLog(uid, site);
  return data;
}

export async function allServer(): Promise<any> {
  const servers: TPTServer[] = await mysql.getAllServers();
  const resData: any[] = [];
  for (const server of servers) {
    const serverData = await getDailyServerData(String(server.id));
    const item = Object.assign({}, server, { serverData });
    resData.push(item);
  }
  return resData;
}

async function getDailyLoadData(uid?: string): Promise<{uploadCount: number; downloadCount: number; increasedCount: number}> {
  const time: Date = moment(UTF8Time()).subtract('day', 1).toDate();
  const loadData = await mysql.getDownloaderByTime(time, uid);
  let uploadCount: number = 0;
  let downloadCount: number = 0;
  let increasedCount: number = 0;
  for (const item of loadData) {
    const { upload, increased_upload, download } = item;
    uploadCount += Number(upload) || 0;
    downloadCount += Number(download) || 0;
    increasedCount += Number(increased_upload) || 0;
  }

  return {
    uploadCount, downloadCount, increasedCount
  }
}

async function getDailyServerData(serverId?: string): Promise<any[]> {
  const yesterday: Date = moment(UTF8Time()).subtract('day', 1).toDate();
  const items = await mysql.getServerDataByTime(yesterday, serverId);
  return items;
}

async function getDailySiteData(uid?: string): Promise<any[]> {
  const yesterday: Date = moment(UTF8Time()).subtract('day', 1).toDate();
  const items = await mysql.getSiteDataByTime(yesterday, uid);
  return items;
}

async function getDailyLog(uid?: string, site?: string): Promise<any[]> {
  const yesterday: Date = moment(UTF8Time()).subtract('day', 1).toDate();
  const items = await mysql.getUserLogByTime(yesterday, uid, site);
  return items;
}
