
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
}
