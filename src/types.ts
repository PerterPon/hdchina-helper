
export interface TItem {
  id: string;
  uid: string;
  site: string;
  free?: boolean;
  freeUntil?: Date;
  size: number;
  title: string;
  torrentUrl: string;
  transHash?: string;
  serverId: number;
}

export interface TPTUserInfo {
  nickname: string;
  uploadCount: number;
  paid: number;
  site: string;
  cookie: string;
  uid: string;
  cycleTime: number;
  vip: boolean;
  serverIds: number[];
}

export interface TPTServer {
  id: number;
  ip: string;
  port: number;
  username: string;
  password: string;
  type: string;
  box: boolean;
  fileDownloadPath: string;
  minSpaceLeft: number;
  minStayFileSize: number;
  downloadSpeed?: number;
  uploadSpeed?: number;
  activeNumber?: number;
}
