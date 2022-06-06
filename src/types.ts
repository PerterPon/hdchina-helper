
export interface TItem {
  id: string;
  uid: string;
  site: string;
  free: boolean;
  freeUntil?: Date;
  publishDate: Date;
  size: number;
  title: string;
  torrentUrl: string;
  transHash?: string;
  serverId: number;
  transId?: number;
  finished?: boolean;
  activeDate?: Date;
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
  vipNormalItemCount: number;
  proxy: boolean;
  proxyAddr: string;
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
  proxy: string;
  macAddress: string;
  agentPort: number;
  downloadSpeed?: number;
  uploadSpeed?: number;
  activeNumber?: number;
  nodeAddr: string;
  projAddr: string;
}

export enum ETransmissionStatus {
  STOPPED       = 0, //  # Torrent is stopped
  CHECK_WAIT    = 1, //  # Queued to check files
  CHECK         = 2, //  # Checking files
  DOWNLOAD_WAIT = 3, //  # Queued to download
  DOWNLOAD      = 4, //  # Downloading
  SEED_WAIT     = 5, //  # Queued to seed
  SEED          = 6, //  # Seeding
  ISOLATED      = 7, //  # Torrent can't find peers
};

export interface TTransmission {
  get(...params: any[]): Promise<any>;
  active(...params: any[]): Promise<any>;
  addUrl(...params: any[]): Promise<any>;
  addBase64(...params: any[]): Promise<any>;
  sessionStats(...params: any[]): Promise<any>;
  freeSpace(...params: any[]): Promise<any>;
  remove(...params: any[]): Promise<any>;
  status: ETransmissionStatus;
}

export interface TSiteData {
  uploadCount: number;
  downloadCount: number;
  shareRatio: number;
  magicPoint: number;
  uploadSpeed: number;
  downloadSpeed: number;
};

export interface TFileItem {
  siteId: string;
  downloaded: boolean;
  createTime: number;
  createDate?: Date;
}
