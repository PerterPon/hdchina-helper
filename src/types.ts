
export interface TItem {
  id: string;
  uid: string;
  site: string;
  free?: boolean;
  freeUntil?: Date;
  publishDate: Date;
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
  passkey: string;
  userDataDir: string;
  siteDataOnly: boolean;
}

export interface TPTServer {
  id: number;
  ip: string;
  port: number;
  username: string;
  password: string;
  type: string;
  box: boolean;
  oriFileDownloadPath: string;
  fileDownloadPath: string;
  minSpaceLeft: number;
  minStayFileSize: number;
  downloadSpeed?: number;
  uploadSpeed?: number;
  activeNumber?: number;
}

export interface TTransmission {
  get(...params: any[]): Promise<any>;
  active(...params: any[]): Promise<any>;
  addUrl(...params: any[]): Promise<any>;
  sessionStats(...params: any[]): Promise<any>;
  freeSpace(...params: any[]): Promise<any>;
  remove(...params: any[]): Promise<any>;
}
