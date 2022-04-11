
import * as config from './config';
import * as utils from './utils';
import axios, { AxiosResponse } from 'axios';
import { XMLParser } from 'fast-xml-parser';
import { parse as parseUrl, UrlWithParsedQuery } from 'url';
import * as qs from 'qs';
import * as fs from 'fs';
import * as path from 'path';
import * as filesize from 'filesize';
import * as moment from 'moment';
import * as mysql from './mysql';
import * as transmission from './transmission';
import * as oss from './oss';

config.init();

export interface TItem {
  id: string;
  hash: string;
  free?: boolean;
  freeUntil?: Date;
  size: number;
  title: string;
  torrentUrl: string;
  transHash: string;
}

async function main(): Promise<void> {
  await init();
  // 1. 
  const rssString: string = await getRssContent();
  const parser: XMLParser = new XMLParser({
    ignoreAttributes: false
  });
  // 2. 
  const rss: object = parser.parse(rssString);
  // 3.
  const items: TItem[] = await getItemInfo(rss);
  // 4.
  const freeItems: TItem[] = await filterFreeItem(items);
  console.log(`[${utils.displayTime()}] free items: [${JSON.stringify(freeItems)}]`);
  await mysql.storeItem(freeItems);
  // 5.
  const canDownloadItem: TItem[] = await mysql.getFreeItems();
  // 6. 
  await downloadItem(canDownloadItem);
  // 7.
  await uploadItem(canDownloadItem);
  const trans: { transId: string; hash: string; }[] = await addItemToTransmission(canDownloadItem);
  // 8.
  await updateTrans2Item(trans, canDownloadItem);
  await mysql.setItemDownloading(canDownloadItem);
  await utils.sleep(5 * 1000);
  // 9. 
  const downloadingItems: TItem[] = await getDownloadingItems();
  // 10. 
  const beyondFreeItems: TItem[] = await filterBeyondFreeItems(downloadingItems);
  // 11. 
  await removeItemFromTransmission(beyondFreeItems);
  console.log(`[${utils.displayTime()}] all task done!!!!\n`);
  process.exit(0);
}

async function init(): Promise<void> {
  await config.init();
  await mysql.init();
  await transmission.init();
  await oss.init();
}

async function getRssContent(): Promise<string> {
  console.log(`[${utils.displayTime()}] get rss content`);
  return rss;
  // const configInfo: config.TTBSConfig = config.getConfig();
  // const res: AxiosResponse = await axios.get(configInfo.hdchina.rssLink);
  // return res.data;
}

async function getItemInfo(rss: any): Promise<TItem[]> {
  console.log(`[${utils.displayTime()}] get item info`);
  const { item } = rss.rss.channel;
  const items: TItem[] = [];
  for(const it of item) {
    const { link, enclosure, title, guid } = it;
    const linkRes: UrlWithParsedQuery = parseUrl(link, true);
    const id: string = linkRes.query.id as string;
    const { '@_url': enclosureUrl, '@_length': length } = enclosure;
    const hashRes: UrlWithParsedQuery = parseUrl(enclosureUrl, true);
    const hash: string = hashRes.query.hash as string;
    items.push({
      id, hash,
      size: length,
      title,
      torrentUrl: enclosureUrl,
      transHash: guid['#text']
    });
  }
  return items;
}

async function filterFreeItem(items: TItem[], retryTime: number = 0): Promise<TItem[]> {
  console.log(`[${utils.displayTime()}] filterFreeItem`);
  const configInfo = config.getConfig();
  const { globalRetryTime } = configInfo.hdchina;
  if (retryTime >= globalRetryTime) {
    console.warn(`[${utils.displayTime()}] exceed max filter free time!`);
    return [];
  }
  retryTime++;
  console.log(`[${utils.displayTime()}] filterFreeItem with time: [${retryTime}]`);
  const ids: string[] = [];
  for (const item of items) {
    ids.push(item.id);
  }
  const itemDetail = await utils.getItemDetailByIds(ids);
  console.log('getItemDetailByIds', itemDetail);
  const freeItem: TItem[] = [];
  let noneFreeCount: number = 0;
  for (let i = 0; i < items.length; i++) {
    const item: TItem = items[i];
    const ddlItem = itemDetail.message[item.id];
    const { sp_state, timeout } = ddlItem;
    if (
      -1 === sp_state.indexOf('display: none') && 
      (-1 < sp_state.indexOf('pro_free') || -1 < sp_state.indexOf('pro_free2up') ) &&
      '' !== timeout
    ) {
      const [ ddl ] = timeout.match(/\d\d\d\d-\d\d-\d\d\s\d\d:\d\d:\d\d/);
      const ddlTime: Date = new Date(ddl);
      item.freeUntil = ddlTime;
      item.free = true;
      freeItem.push(item);
    } else {
      noneFreeCount++;
      item.free = false;
    }
  }
  if (noneFreeCount === items.length) {
    return await filterFreeItem(items, retryTime);
  }
  return freeItem;
}

async function downloadItem(items: TItem[]): Promise<void> {
  console.log(`[${utils.displayTime()}] downloadItem: [${JSON.stringify(items)}]`);
  const configInfo = config.getConfig();
  const { downloadUrl, uid, downloadPath } = configInfo.hdchina;
  let downloadCount: number = 0;
  let existsTorrentCount: number = 0;
  let downloadErrorCount: number = 0;
  for (const item of items) {
    await utils.sleep(2 * 1000);
    const { hash, title, id, size, freeUntil, transHash } = item;
    const fileName: string = path.join(downloadPath, `${transHash}.torrent`);
    if (false === fs.existsSync(fileName)) {
      try {
        // not exist, download
        const downloadLink = `${downloadUrl}?hash=${hash}&uid=${uid}`;
        const fileWriter = fs.createWriteStream(fileName);
        const res: AxiosResponse = await axios({
          url: downloadLink,
          method: 'get',
          responseType: 'stream',
          headers: {
            ...utils.downloadHeader
          }
        });
        await utils.writeFile(res.data, fileWriter);
        const leftTime: number = moment(freeUntil).unix() - moment().unix();
        console.log(`[${utils.displayTime()}] download torrent: [${fileName}], size: [${filesize(size)}], free time: [${moment(freeUntil).diff(moment(), 'hours')} H]`);
        downloadCount++;
      } catch (e) {
        downloadErrorCount++;
        console.error(`[ERROR][${utils.displayTime()}] download file: [${fileName}] with error: [${e.message}]`);
      }
    } else {
      existsTorrentCount++;
    }
  }
  console.log(`[${utils.displayTime()}] all torrents download complete! download number: [${downloadCount}], exists torrent count: [${existsTorrentCount}], download error count: [${downloadErrorCount}]`);
}

async function uploadItem(items: TItem[]): Promise<void> {
  console.log(`[${utils.displayTime()}] upload items: [${JSON.stringify(items)}]`);
  const configInfo = config.getConfig();
  const { downloadPath } = configInfo.hdchina;
  for (const item of items) {
    const { transHash } = item;
    const fileName: string = `${transHash}.torrent`;
    const filePath: string = path.join(downloadPath, `${transHash}.torrent`);
    await oss.uploadFile(fileName, filePath);
  }
}

async function addItemToTransmission(items: TItem[]): Promise<{transId: string; hash: string;}[]> {
  console.log(`[${utils.displayTime()}] addItemToTransmission: [${JSON.stringify(items)}]`);
  const transIds: {transId: string; hash: string;}[] = [];
  const configInfo = config.getConfig();
  const { cdnHost } = configInfo.hdchina.aliOss;
  for (const item of items) {
    const { transHash, title } = item;
    const torrentUrl: string = `http://${cdnHost}/${transHash}.torrent`;
    console.log(`[${utils.displayTime()}] add file to transmission: [${title}]`);
    const transRes: { transId: string; hash: string } = await transmission.addUrl(torrentUrl);
    transIds.push(transRes);
  }
  return transIds;
}

async function updateTrans2Item(transIds: {transId: string; hash: string}[], items: TItem[]): Promise<void> {
  console.log(`[${utils.displayTime()}] updateTransId2Item transIds: [${JSON.stringify(transIds)}], items: [${JSON.stringify(items)}]`);

  for (let i = 0; i < transIds.length; i++) {
    const { transId, hash } = transIds[i];
    const item: TItem = items[i];
    const { transHash } = item;
    await mysql.updateItemByTransHash(transHash, {
      trans_id: transId
    });
  }
}

async function getDownloadingItems(): Promise<TItem[]> {
  console.log(`[${utils.displayTime()}] getDownloadingItems`);
  const downloadingTransItems: transmission.TTransItem[] = await transmission.getDownloadingItems();
  const downloadingHash: string[] = [];
  const configInfo = config.getConfig();
  const { fileDownloadPath } = configInfo.hdchina.transmission;
  for (const item of downloadingTransItems) {
    const { hash, downloadDir } = item;
    // only the specific torrent we need to remove.
    if (downloadDir === fileDownloadPath) {
      downloadingHash.push(hash);
    }
  }
  const downloadingItems: TItem[] = await mysql.getItemByHash(downloadingHash);
  const downloadingItemNames: string[] = [];
  for (const downloadingItem of downloadingItems) {
    downloadingItemNames.push(downloadingItem.title);
  }
  console.log(`[${utils.displayTime()}] downloading item names: [${downloadingItemNames.join('\n')}]`);
  return downloadingItems;
}

async function filterBeyondFreeItems(items: TItem[]): Promise<TItem[]> {
  console.log(`[${utils.displayTime()}] filterBeyondFreeItems: [${JSON.stringify(items)}]`);
  const beyondFreeItems: TItem[] = [];
  for (const item of items) {
    const { freeUntil } = item;
    if (moment(freeUntil) < moment()) {
      beyondFreeItems.push(item);
    }
  }
  return beyondFreeItems;
}

async function removeItemFromTransmission(items: TItem[]): Promise<void> {
  console.log(`[${utils.displayTime()}] removeItemFromTransmission: [${JSON.stringify(items)}]`);
  const transIds: string[] = await mysql.getTransIdByItem(items);
  for (const transId of transIds) {
    await transmission.removeItem(transId);
  }
}

main();

process.on('uncaughtException', (e) => {
  console.log(e);
  throw e;
});

process.on('uncaughtException', (e) => {
  console.error(e);
  process.exit(1);
})

const rss = `
This XML file does not appear to have any style information associated with it. The document tree is shown below.
<rss version="2.0">
<channel>
<title>HDChina Torrents</title>
<link>https://hdchina.org</link>
<description>Latest torrents from HDChina - </description>
<language>zh-cn</language>
<copyright>Copyright (c) HDChina 2013-2022, all rights reserved</copyright>
<managingEditor>hdchina.club@gmail.com (HDChina Admin)</managingEditor>
<webMaster>hdchina.club@gmail.com (HDChina Webmaster)</webMaster>
<pubDate>Mon, 11 Apr 2022 15:47:15 +0800</pubDate>
<generator>NexusPHP RSS Generator v2</generator>
<docs>http://www.rssboard.org/rss-specification</docs>
<ttl>60</ttl>
<image>
<url>https://hdchina.org/pic/rss_logo.jpg</url>
<title>HDChina Torrents</title>
<link>https://hdchina.org</link>
<width>100</width>
<height>100</height>
<description>
<![CDATA[ HDChina Torrents ]]>
</description>
</image>
<item>
<title>Glory.of.Special.Forces.Music.Festival.2022.WEB-DL.4k.H265.AAC-HDCTV</title>
<link>https://hdchina.org/details.php?id=587975</link>
<description>
<![CDATA[ <fieldset><legend> 引用 </legend><font size="3"><b><span style="color: blue;">HDChina</span><span style="color: red;">原创作品，转载压制请注意礼节，谢谢合作！</span><br /> <span style="color: blue;">HDChina</span><span style="color: red;"> original works, Please specify your rip source in your rip/NFO note. Thanks!</span></b></font></fieldset><br /> <br /> <img id="attach153192" alt="002Po4pSly1h0zsouoe4lj60u01hcwrl02.jpg" src="attachments/202204/202204111519366c0cfd93bde531875873a390b79fae82.jpg" onmouseover="domTT_activate(this, event, 'content', '&lt;strong&gt;大小&lt;/strong&gt;: 481.95 KB&lt;br /&gt;&lt;span title=&quot;2022-04-11 15:19:36&quot;&gt;27分前&lt;/span&gt;', 'styleClass', 'attach', 'x', findPosition(this)[0], 'y', findPosition(this)[1]-58);" /><br /> <br /> <fieldset><legend> 引用: 视频参数 </legend>【文件名称】...... Glory of Special Forces Music Festival 20220406 WEB-DL 4k H265 AAC-HDCTV<br /> 【日　　期】...... 2022-04-11<br /> 【时　　长】...... 21m:22s<br /> 【体　　积】...... 943 MiB<br /> 【帧　　率】...... 25.000 fps<br /> 【视频编码】...... H.265_Main_L5 @ 6 043 Kbps<br /> 【音频编码】...... AAC 2.0 @ 125 Kbps<br /> 【视频尺寸】...... 3840x2160p (16:9)<br /> 【视频格式】...... MP4<br /> 【字　　幕】...... 无字幕<br /> 【制作团队】...... HDCTV</fieldset> &nbsp;<br /> <img id="attach88220" alt="f426542dd6d0d44825b0f2baae30639b.jpg" src="attachments/201705/20170526101902f426542dd6d0d44825b0f2baae30639b.jpg" onmouseover="domTT_activate(this, event, 'content', '&lt;strong&gt;大小&lt;/strong&gt;: 26.04 KB&lt;br /&gt;&lt;span title=&quot;2017-05-26 10:19:02&quot;&gt;4年11月前&lt;/span&gt;', 'styleClass', 'attach', 'x', findPosition(this)[0], 'y', findPosition(this)[1]-58);" /><br /> <br /> <a class="faqlink" href="https://img.hdchina.org/image/ee9c127c3c7c.cGXqg"><img alt="image" src="https://img.hdchina.org/images/2022/04/11/ee9c127c3c7c.md.png" /></a> <a class="faqlink" href="https://img.hdchina.org/image/d35f9612b891.cGleR"><img alt="image" src="https://img.hdchina.org/images/2022/04/11/d35f9612b891.md.png" /></a> <a class="faqlink" href="https://img.hdchina.org/image/a171379a0403.cGcFs"><img alt="image" src="https://img.hdchina.org/images/2022/04/11/a171379a0403.md.png" /></a> <a class="faqlink" href="https://img.hdchina.org/image/48a7e9344b9e.cGQUn"><img alt="image" src="https://img.hdchina.org/images/2022/04/11/48a7e9344b9e.md.png" /></a> <a class="faqlink" href="https://img.hdchina.org/image/4a95e1c3e7ba.cGkoH"><img alt="image" src="https://img.hdchina.org/images/2022/04/11/4a95e1c3e7ba.md.png" /></a> <a class="faqlink" href="https://img.hdchina.org/image/7bf4c1a9f33b.cG1Mr"><img alt="image" src="https://img.hdchina.org/images/2022/04/11/7bf4c1a9f33b.md.png" /></a> <a class="faqlink" href="https://img.hdchina.org/image/bcfd5f24218b.cGomU"><img alt="image" src="https://img.hdchina.org/images/2022/04/11/bcfd5f24218b.md.png" /></a> <a class="faqlink" href="https://img.hdchina.org/image/411da23709b4.cGDBP"><img alt="image" src="https://img.hdchina.org/images/2022/04/11/411da23709b4.md.png" /></a><br /> <font size="3"><span style="color: green;"><b><font face="Microsoft YaHei">本资源仅限会员测试带宽之用，严禁用于商业用途！<br /> 对用于商业用途所产生的法律责任，由使用者自负！</font></span></b></font> ]]>
</description>
<author>anonymous@hdchina.org (anonymous)</author>
<category domain="https://hdchina.org/torrents.php?cat=401">综艺(TV Shows)</category>
<comments>
<![CDATA[ https://hdchina.org/details.php?id=587975&cmtpage=0#startcomments ]]>
</comments>
<enclosure url="https://hdchina.org/download.php?hash=NZ7nNfrW_4A1K3xb4A1IQw&uid=325966" length="3741638036" type="application/x-bittorrent"/>
<guid isPermaLink="false">2f61a45026d33fcecc0aa0ab8b18df3ddb46ba86</guid>
<pubDate>Mon, 11 Apr 2022 15:22:30 +0800</pubDate>
</item>
<item>
<title>Christiane F. - Wir Kinder vom Bahnhof Zoo AKA Christiane F. - We Children from Bahnhof Zoo 1981 2160p GER UHD Blu-ray HEVC DTS-HD MA 5.1-SURCODE</title>
<link>https://hdchina.org/details.php?id=587969</link>
<description>
<![CDATA[ <img alt="image" src="https://images.static-bluray.com/movies/covers/310601_front.jpg" /><br /> ◎译　　名　堕落街/We Children from Bahnhof Zoo/一个少女的自白<br /> ◎片　　名　Christiane F. - Wir Kinder vom Bahnhof Zoo<br /> ◎年　　代　1981<br /> ◎产　　地　西德<br /> ◎类　　别　剧情 / 传记<br /> ◎语　　言　德语<br /> ◎上映日期　1981-04-02<br /> ◎IMDb评分  7.6/10 from 24664 users<br /> ◎IMDb链接  <a class="faqlink" href="https://www.imdb.com/title/tt0082176/">https://www.imdb.com/title/tt0082176/</a><br /> ◎豆瓣评分　7.8/10 from 4354 users<br /> ◎豆瓣链接　<a class="faqlink" href="https://movie.douban.com/subject/1304239/">https://movie.douban.com/subject/1304239/</a><br /> ◎片　　长　138 分钟<br /> ◎导　　演　乌利·埃德尔 Uli Edel<br /> ◎编　　剧　乌利·埃德尔 Uli Edel / 赫尔曼·魏格尔 Herman Weigel<br /> ◎主　　演　娜娅·布鲁克霍斯特 Natja Brunckhorst<br /> 　　　　  　Eberhard Auriga Eberhard Auriga<br /> 　　　　  　大卫·鲍伊 David Bowie<br /> 　　　　  　Christiane Felscherinow Christiane Felscherinow<br /> <br /> ◎简　　介<br /> <br /> 　　本片背景为20世纪70年代的德国，讲述了一名14岁的少女从吸毒到卖淫，一步步走向堕落的故事。<br /> 　　未满14岁的克里斯蒂安娜（娜娅·布鲁克霍斯特 Natja Brunckhorst 饰）来自一个离异家庭，她和母亲妹妹一同生活在西柏林一家公寓里。当时的年轻人都到当地一家迪斯科“Sound”里玩，在朋友的陪同下，未成年的她也进入了这个迷幻世界。在这里，她认识了少年德特勒夫和他的朋友们。夜里，他们一群人常常一起流连街头，渐渐地，她爱上了德特勒夫，还尝试和他一起吸食迷幻剂。为了搞到买毒品的钱，德特勒夫会到一个叫“动物园”的地方物色对象进行卖淫。克里斯蒂安娜一开始不愿意德特勒夫做这种事，后来她自己也开始注射毒品，也开始到“动物园”里来。少女克里斯蒂安娜，一步步走向迷幻堕落的深渊……<br /> 　　本片根据少女克里斯蒂安娜·F的亲身经历改编。<br /> <fieldset><legend> 引用 </legend>Disc Title: Christiane F. - Wir Kinder vom Bahnhof Zoo<br /> Disc Label: Christiane.F.1981.COMPLETE.UHD.BLURAY-SURCODE<br /> Disc Size: 56,536,885,657 bytes<br /> Protection: AACS2<br /> Playlist: 00003.MPLS<br /> Size: 45,089,252,160 bytes<br /> Length: 2:10:53.166<br /> Total Bitrate: 45.93 Mbps<br /> Video: MPEG-H HEVC Video / 39541 kbps / 2160p / 24 fps / 16:9 / Main 10 @ Level 5.1 @ High / 10 bits / BT.709<br /> Audio: German / DTS-HD Master Audio / 2.0 / 48 kHz /   927 kbps / 16-bit (DTS Core: 2.0 / 48 kHz /   768 kbps / 16-bit)<br /> Audio: German / DTS-HD Master Audio / 5.1 / 48 kHz /  1976 kbps / 16-bit (DTS Core: 5.1 / 48 kHz /  1509 kbps / 16-bit)<br /> Audio: German / DTS-HD Master Audio / 2.0 / 48 kHz /   960 kbps / 16-bit (DTS Core: 2.0 / 48 kHz /   768 kbps / 16-bit)<br /> Subtitle: German / 16.034 kbps<br /> Subtitle: English / 7.735 kbps</fieldset><a class="faqlink" href="https://pixhost.to/show/100/276883882_00006_1962_compr.png"><img alt="image" src="https://t70.pixhost.to/thumbs/100/276883882_00006_1962_compr.png" /></a><a class="faqlink" href="https://pixhost.to/show/100/276883911_00006_2943_compr.png"><img alt="image" src="https://t70.pixhost.to/thumbs/100/276883911_00006_2943_compr.png" /></a><a class="faqlink" href="https://pixhost.to/show/100/276883948_00006_3924_compr.png"><img alt="image" src="https://t70.pixhost.to/thumbs/100/276883948_00006_3924_compr.png" /></a><a class="faqlink" href="https://pixhost.to/show/100/276883995_00006_4905_compr.png"><img alt="image" src="https://t70.pixhost.to/thumbs/100/276883995_00006_4905_compr.png" /></a> ]]>
</description>
<author>anonymous@hdchina.org (anonymous)</author>
<category domain="https://hdchina.org/torrents.php?cat=410">4K UltraHD</category>
<comments>
<![CDATA[ https://hdchina.org/details.php?id=587969&cmtpage=0#startcomments ]]>
</comments>
<enclosure url="https://hdchina.org/download.php?hash=HUgRYkFbG3Xiu4xNRBdaUA&uid=325966" length="56536885657" type="application/x-bittorrent"/>
<guid isPermaLink="false">18f61c58f65931669fefafabc7aa6978fd0f4f3b</guid>
<pubDate>Mon, 11 Apr 2022 15:09:19 +0800</pubDate>
</item>
<item>
<title>Hunger.2008.CC.BluRay.1080p.x264.DTS-CMCT</title>
<link>https://hdchina.org/details.php?id=586505</link>
<description>
<![CDATA[ <fieldset><legend> 引用 </legend><b><span style="color: Blue;">转自CMCT，感谢原制作者发布。</span></b></fieldset><br /> <br /> <img alt="image" src="https://static.hdcmct.org/cmct-images/2022/04/09/0Gz7r.jpg" /><br /> <br /> <br /> &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;<span style="color: teal;"><font size="3"><b><br /> 感觉豆瓣的译名“饥饿”不够准确，还是采用香港译法。<br /> 片源：Hunger.2008.RA.1080p.CC.Blu-ray.AVC.DTS-HD.MA.5.1-smwy8888@DyFm<br /> 字幕：重校了一遍本人2016年做的字幕，按惯例逐句调轴。<br /> </b></font></span><br /> &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;<br /> ◎译　　名　饥饿/大绝食(港)/饥饿宣言(台)/绝食<br /> ◎片　　名　Hunger<br /> ◎年　　代　2008<br /> ◎产　　地　英国 / 爱尔兰<br /> ◎类　　型　电影<br /> ◎类　　别　剧情 / 传记<br /> ◎语　　言　英语 / 爱尔兰语<br /> ◎预算票房　$0 / $3,185,113<br /> ◎上映日期　2008-05-15(戛纳电影节) / 2008-10-31(英国/爱尔兰)<br /> ◎MPAA评级　Not Rated(美国) / 15A(爱尔兰)<br /> ◎IMDb评分　7.6/10 from 62,502 users<br /> ◎IMDb链接　<a class="faqlink" href="https://www.imdb.com/title/tt0986233/">https://www.imdb.com/title/tt0986233/</a><br /> ◎豆瓣评分　8.0/10 from 13,721 users<br /> ◎豆瓣链接　<a class="faqlink" href="https://movie.douban.com/subject/3070921/">https://movie.douban.com/subject/3070921/</a><br /> ◎片　　长　96分钟<br /> <br /> <br /> ◎标　　签　英国 | 爱尔兰 | 政治 | 传记 | 剧情 | 2008 | 监狱 | 人性<br /> ◎简　　介<br /> 　　北爱共和军领导人鲍比•桑兹（迈克尔•法斯宾德 Michael Fassbender 饰）因为领导反对当局的游行而被捕。在梅兹监狱中，他依然没有放弃斗争。监狱里都是六平方米的封闭牢房，这里关押着北爱共和军的囚犯，他们赤身裸体拒绝穿囚衣，以此对抗撒切尔夫人剥夺囚犯权利的法令。他们用污浊的食物和排泄物掩盖着变形门下的沟渠，以此传递消息。 <br /> <br /> 　　通过一台蒙混过关的收音机，囚犯们得以及时了解共和军与英国政府斗争的消息。最后，在桑兹决定以绝食抗争的时候，他与神父多米尼克•莫朗（利亚姆•坎宁安 Liam Cunningham 饰）有过一场精彩的辩论，然而结果却于事无补…… <br /> <br /> 　　本片获得第61届戛纳电影节金摄影机奖。 &nbsp; &nbsp;<br /> <br /> <fieldset><legend> 引用 </legend>文件名: [大绝食].Hunger.2008.CC.BluRay.1080p.x264.DTS-CMCT.mkv<br /> 日　期: 2022-04-09<br /> 体　积: 10.3 GiB<br /> 时　长: 1h 36min<br /> 帧　率: 23.976 fps<br /> 参　数: me=umh subme=11<br /> 分辨率: 1920 x 1080 (16:9)<br /> 视　频: x264 @ 13.8 Mbps<br /> 音　频: English DTS 5.1 @ 1509 Kbps<br /> 字　幕: Chinese ASS (中上英下ASS)<br /> 　　　　English ASS (英上中下ASS)<br /> 　　　　Chinese ASS (简体中文ASS)<br /> 　　　　Chinese ASS (繁体中文ASS)<br /> 　　　　English ASS (英文ASS)</fieldset><br /> <br /> <img alt="image" src="https://static.hdcmct.org/cmct-images/2022/04/09/0GbSf.jpg" /><br /> <a class="faqlink" href="https://ibb.co/0hF4CS2"><img alt="image" src="https://i.ibb.co/KFL42kh/Hunger-2008-CC-Blu-Ray-1080p-x264-DTS-CMCT-mkv-20220411-143918-532.jpg" /></a><br /> <a class="faqlink" href="https://ibb.co/z7LcFCv"><img alt="image" src="https://i.ibb.co/X3dBD6R/Hunger-2008-CC-Blu-Ray-1080p-x264-DTS-CMCT-mkv-20220411-143927-746.jpg" /></a><br /> <a class="faqlink" href="https://ibb.co/P1PTysM"><img alt="image" src="https://i.ibb.co/kqw3TVJ/Hunger-2008-CC-Blu-Ray-1080p-x264-DTS-CMCT-mkv-20220411-143933-315.jpg" /></a> ]]>
</description>
<author>2020A@hdchina.org (2020A)</author>
<category domain="https://hdchina.org/torrents.php?cat=17">电影Movie(1080p)</category>
<comments>
<![CDATA[ https://hdchina.org/details.php?id=586505&cmtpage=0#startcomments ]]>
</comments>
<enclosure url="https://hdchina.org/download.php?hash=GqSq2CGEpvCkYUwQnp9qSA&uid=325966" length="11098361787" type="application/x-bittorrent"/>
<guid isPermaLink="false">b770e122cde5a647ca92ccbfe5fc97ac55cc8862</guid>
<pubDate>Mon, 11 Apr 2022 14:49:24 +0800</pubDate>
</item>
<item>
<title>Young.Sheldon.S05E01-13.1080p.AMZN.WEB-DL.DDP5.1.H.264-playWEB</title>
<link>https://hdchina.org/details.php?id=587944</link>
<description>
<![CDATA[ <fieldset><legend> 引用 </legend>非完结打包，1-13集</fieldset><img alt="image" src="https://img9.doubanio.com/view/photo/l_ratio_poster/public/p2692536045.jpg" /><br /> <br /> ◎译　　名　小谢尔顿 第五季/少年谢尔顿/少年谢耳朵/小小谢尔顿/谢尔顿/Sheldon<br /> ◎片　　名　Young Sheldon Season 5<br /> ◎年　　代　2021<br /> ◎产　　地　美国<br /> ◎类　　别　喜剧<br /> ◎语　　言　英语<br /> ◎上映日期　2021-10-07(美国)<br /> ◎IMDb评分 &nbsp;7.6/10 from 278 users<br /> ◎IMDb链接 &nbsp;<a class="faqlink" href="https://www.imdb.com/title/tt14356298/">https://www.imdb.com/title/tt14356298/</a><br /> ◎豆瓣评分　9.3/10 from 1900 users<br /> ◎豆瓣链接　<a class="faqlink" href="https://douban.com/subject/35420023/">https://douban.com/subject/35420023/</a><br /> ◎集　　数　3<br /> ◎片　　长　30分钟<br /> ◎导　　演　艾力克斯·里德 Alex Reid<br /> ◎编　　剧　查克·罗瑞 Chuck Lorre / 史蒂文·莫拉 Steven Molaro / 史蒂夫·霍兰德 Steve Holland / 埃里克·卡普兰 Eric Kaplan / 尼克·伯凯 Nick Bakay<br /> ◎主　　演　伊恩·阿米蒂奇 Iain Armitage<br /> 　　　　 &nbsp;　佐伊·派瑞 Zoe Perry<br /> 　　　　 &nbsp;　兰斯·巴伯 Lance Barber<br /> 　　　　 &nbsp;　蒙塔纳·乔丹 Montana Jordan<br /> 　　　　 &nbsp;　拉根·雷沃德 Raegan Revord<br /> 　　　　 &nbsp;　安妮·波茨 Annie Potts<br /> 　　　　 &nbsp;　吉姆·帕森斯 Jim Parsons<br /> 　　　　 &nbsp;　华莱士·肖恩 Wallace Shawn<br /> 　　　　 &nbsp;　梅莉莎·彼得曼 Melissa Peterman<br /> 　　　　 &nbsp;　艾娃·艾伦 Ava Allan<br /> 　　　　 &nbsp;　汤姆·易 Tom Yi<br /> <br /> ◎标　　签　美剧 | 谢耳朵 | 喜剧 | 生活大爆炸 | 衍生剧 | 美国 | 电视剧 | CBS<br /> <br /> ◎简　　介<br /> <br /> 　　<br /> 　　主要讲述童年时期的谢尔顿跟家人一同在德克萨斯州生活的一系列故事。<br /> 　　<br /> <fieldset><legend> 引用 </legend>General<br /> Unique ID &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;: 150538266587425024171170938193412896200 (0x71409D94024935E679F19DE208B835C8)<br /> Complete name &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;: C:\torrent\Young.Sheldon.S05.1080p.AMZN.WEB-DL.DDP5.1.H.264-playWEB\Young.Sheldon.S05E01.One.Bad.Night.and.Chaos.of.Selfish.Desires.1080p.AMZN.WEB-DL.DDP5.1.H.264-playWEB.mkv<br /> Format &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : Matroska<br /> Format version &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : Version 4<br /> File size &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;: 994 MiB<br /> Duration &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : 21 min 20 s<br /> Overall bit rate &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : 6 512 kb/s<br /> Encoded date &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : UTC 2021-11-15 19:21:44<br /> Writing application &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;: mkvmerge v53.0.0 ('Fool's Gold') 64-bit<br /> Writing library &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;: libebml v1.4.1 + libmatroska v1.6.2<br /> <br /> Video<br /> ID &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : 1<br /> Format &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : AVC<br /> Format/Info &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;: Advanced Video Codec<br /> Format profile &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : High@L4<br /> Format settings &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;: CABAC / 4 Ref Frames<br /> Format settings, CABAC &nbsp; &nbsp; &nbsp; &nbsp; : Yes<br /> Format settings, Reference fra : 4 frames<br /> Codec ID &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : V_MPEG4/ISO/AVC<br /> Duration &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : 21 min 20 s<br /> Bit rate mode &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;: Constant<br /> Bit rate &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : 5 870 kb/s<br /> Nominal bit rate &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : 10 000 kb/s<br /> Width &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;: 1 920 pixels<br /> Height &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : 1 080 pixels<br /> Display aspect ratio &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : 16:9<br /> Frame rate mode &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;: Constant<br /> Frame rate &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : 23.976 (24000/1001) FPS<br /> Color space &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;: YUV<br /> Chroma subsampling &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : 4:2:0<br /> Bit depth &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;: 8 bits<br /> Scan type &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;: Progressive<br /> Bits/(Pixel*Frame) &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : 0.118<br /> Stream size &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;: 896 MiB (90%)<br /> Default &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;: Yes<br /> Forced &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : No<br /> Color range &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;: Limited<br /> Color primaries &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;: BT.709<br /> Transfer characteristics &nbsp; &nbsp; &nbsp; : BT.709<br /> Matrix coefficients &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;: BT.709<br /> <br /> Audio<br /> ID &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : 2<br /> Format &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : E-AC-3<br /> Format/Info &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;: Enhanced AC-3<br /> Commercial name &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;: Dolby Digital Plus<br /> Codec ID &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : A_EAC3<br /> Duration &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : 21 min 20 s<br /> Bit rate mode &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;: Constant<br /> Bit rate &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : 640 kb/s<br /> Channel(s) &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : 6 channels<br /> Channel layout &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : L R C LFE Ls Rs<br /> Sampling rate &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;: 48.0 kHz<br /> Frame rate &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : 31.250 FPS (1536 SPF)<br /> Compression mode &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : Lossy<br /> Stream size &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;: 97.7 MiB (10%)<br /> Language &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : English<br /> Service kind &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : Complete Main<br /> Default &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;: Yes<br /> Forced &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : No<br /> <br /> Text<br /> ID &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : 3<br /> Format &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : UTF-8<br /> Codec ID &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : S_TEXT/UTF8<br /> Codec ID/Info &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;: UTF-8 Plain Text<br /> Duration &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : 20 min 48 s<br /> Bit rate &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : 93 b/s<br /> Count of elements &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;: 506<br /> Stream size &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;: 14.3 KiB (0%)<br /> Title &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;: SDH<br /> Language &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : English<br /> Default &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;: No<br /> Forced &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : No<br /> <br /> Menu<br /> 00:00:00.000 &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : en:Previously On<br /> 00:00:40.000 &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : en:Scene 2<br /> 00:03:11.000 &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : en:Title Sequence<br /> 00:03:28.000 &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : en:Scene 4<br /> 00:07:53.000 &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : en:Scene 5<br /> 00:15:05.000 &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : en:Scene 6<br /> 00:20:05.000 &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : en:Scene 7<br /> 00:20:52.000 &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; : en:End Credits<br /> <br /> </fieldset><img alt="image" src="https://ptpimg.me/962r7x.png" /><br /> <img alt="image" src="https://ptpimg.me/h05b55.png" /><br /> <img alt="image" src="https://ptpimg.me/1878hv.png" /><br /> ]]>
</description>
<author>anonymous@hdchina.org (anonymous)</author>
<category domain="https://hdchina.org/torrents.php?cat=21">欧美剧集包(EU/US TV series pack)</category>
<comments>
<![CDATA[ https://hdchina.org/details.php?id=587944&cmtpage=0#startcomments ]]>
</comments>
<enclosure url="https://hdchina.org/download.php?hash=okCkGqyN5BHGqzVxyEBeLQ&uid=325966" length="14958343445" type="application/x-bittorrent"/>
<guid isPermaLink="false">b6cb2fe3dc5f57b756e05726f32da71c7043f3b5</guid>
<pubDate>Mon, 11 Apr 2022 14:27:56 +0800</pubDate>
</item>
<item>
<title>The.355.2022.GER.UHD.Blu-ray.2160p.HEVC.TrueHD.Atmos.7.1-Pete@HDSky</title>
<link>https://hdchina.org/details.php?id=587937</link>
<description>
<![CDATA[ <fieldset><legend> 引用 </legend><b><span style="color: Blue;">转自HDSky，感谢原制作者发布。</span></b></fieldset><br /> <br /> <fieldset><legend> 引用 </legend>原盘@SURCODE &nbsp; &nbsp; &nbsp;字幕@字幕库</fieldset><br /> <img alt="image" src="https://img.hdhome.org/images/2022/04/08/c9ef9586db220d1bd8f62c7af433306a.png" /><br /> <br /> ◎译　　名　355<br /> ◎片　　名　The 355/355：谍影特攻/三五五<br /> ◎年　　代　2022<br /> ◎产　　地　美国/中国<br /> ◎类　　别　动作/惊悚<br /> ◎语　　言　英语<br /> ◎IMDb评分 &nbsp;5.3/10 (18,839 votes)<br /> ◎IMDb链接 &nbsp;<a class="faqlink" href="https://www.imdb.com/title/tt8356942/">https://www.imdb.com/title/tt8356942/</a><br /> ◎片　　长　122分钟<br /> ◎导　　演　西蒙·金伯格 &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;<br /> ◎主　　演 &nbsp; &nbsp;杰西卡·查斯坦<br /> &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; 佩内洛普·克鲁兹<br /> &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; 范冰冰<br /> &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; 露皮塔·尼永奥<br /> &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; 黛安·克鲁格<br /> &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; 塞巴斯蒂安·斯坦<br /> &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; 埃德加·拉米雷兹<br /> ◎简 &nbsp; &nbsp;介<br /> <br /> &nbsp; &nbsp;讲述世界各地的顶级女特工们联合起来，阻止一个全球性组织获得一种武器，这个武器可能会使原本就不稳定的世界陷入完全的混乱之中。她们必须克服文化和政治上的分歧，形成一种纽带，共同努力。355是几位组成的新派系的代号。<br /> <br /> <br /> <fieldset><legend> 引用 </legend>DISC INFO:<br /> <br /> Disc Label: &nbsp; &nbsp; 特工355 The.355.2022.GER.UHD.Blu-ray.2160p.HEVC.TrueHD.Atmos.7.1-Pete@HDSky<br /> Disc Size: &nbsp; &nbsp; &nbsp;65,668,782,012 bytes<br /> Protection: &nbsp; &nbsp; AACS2<br /> Extras: &nbsp; &nbsp; &nbsp; &nbsp; Ultra HD<br /> BDInfo: &nbsp; &nbsp; &nbsp; &nbsp; 0.7.5.8<br /> <br /> PLAYLIST REPORT:<br /> <br /> Name: &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; 00002.MPLS<br /> Length: &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; 2:03:31.945 (h:m:s.ms)<br /> Size: &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; 64,627,519,296 bytes<br /> Total Bitrate: &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;69.75 Mbps<br /> <br /> (*) Indicates included stream hidden by this playlist.<br /> <br /> VIDEO:<br /> <br /> Codec &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; Bitrate &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; Description &nbsp; &nbsp; <br /> ----- &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; ------- &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; ----------- &nbsp; &nbsp; <br /> MPEG-H HEVC Video &nbsp; &nbsp; &nbsp; 45579 kbps &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;2160p / 23.976 fps / 16:9 / Main 10 @ Level 5.1 @ High / 10 bits / HDR10 / BT.2020<br /> * MPEG-H HEVC Video &nbsp; &nbsp; 11404 kbps &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;1080p / 23.976 fps / 16:9 / Main 10 @ Level 5.1 @ High / 10 bits / Dolby Vision / BT.2020<br /> <br /> AUDIO:<br /> <br /> Codec &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; Language &nbsp; &nbsp; &nbsp; &nbsp;Bitrate &nbsp; &nbsp; &nbsp; &nbsp; Description &nbsp; &nbsp; <br /> ----- &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; -------- &nbsp; &nbsp; &nbsp; &nbsp;------- &nbsp; &nbsp; &nbsp; &nbsp; ----------- &nbsp; &nbsp; <br /> Dolby TrueHD/Atmos Audio &nbsp; &nbsp; &nbsp; &nbsp;German &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;3837 kbps &nbsp; &nbsp; &nbsp; 7.1 / 48 kHz / &nbsp;3197 kbps / 24-bit (AC3 Embedded: 5.1 / 48 kHz / &nbsp; 640 kbps / DN -29dB)<br /> Dolby TrueHD/Atmos Audio &nbsp; &nbsp; &nbsp; &nbsp;English &nbsp; &nbsp; &nbsp; &nbsp; 3846 kbps &nbsp; &nbsp; &nbsp; 7.1 / 48 kHz / &nbsp;3206 kbps / 24-bit (AC3 Embedded: 5.1 / 48 kHz / &nbsp; 640 kbps / DN -30dB)<br /> <br /> SUBTITLES:<br /> <br /> Codec &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; Language &nbsp; &nbsp; &nbsp; &nbsp;Bitrate &nbsp; &nbsp; &nbsp; &nbsp; Description &nbsp; &nbsp; <br /> ----- &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; -------- &nbsp; &nbsp; &nbsp; &nbsp;------- &nbsp; &nbsp; &nbsp; &nbsp; ----------- &nbsp; &nbsp; <br /> Presentation Graphics &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; German &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;23.114 kbps &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; <br /> Presentation Graphics &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; English &nbsp; &nbsp; &nbsp; &nbsp; 24.791 kbps &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; <br /> Presentation Graphics &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; German &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;2.270 kbps &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;<br /> Presentation Graphics &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; English &nbsp; &nbsp; &nbsp; &nbsp; 3.272 kbps &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;<br /> <span style="color: red;">Presentation Graphics &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; Chinese &nbsp; &nbsp; &nbsp; &nbsp; 32.486 kbps &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; <br /> Presentation Graphics &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; Chinese &nbsp; &nbsp; &nbsp; &nbsp; 33.597 kbps &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; <br /> Presentation Graphics &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; Chinese &nbsp; &nbsp; &nbsp; &nbsp; 44.627 kbps &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; <br /> Presentation Graphics &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; Chinese &nbsp; &nbsp; &nbsp; &nbsp; 45.688 kbps &nbsp; </span> &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp; &nbsp;<br /> </fieldset><br /> <br /> <img alt="image" src="https://img.hdsky.me/images/2022/04/09/e830f943641b7f1ed3afb3c04497157c.png" /><br /> <br /> <img alt="image" src="https://img.hdsky.me/images/2022/04/09/a9feef3d835794336ef8275bdb56780f.png" /><br /> <br /> <img alt="image" src="https://img.hdsky.me/images/2022/04/09/de1f98161ff148017dc613c27b64b417.png" /><br /> <br /> <img alt="image" src="https://img.hdsky.me/images/2022/04/09/789615711fbd5f617312c9406e9b90a9.png" /><br /> <br /> ]]>
</description>
<author>anonymous@hdchina.org (anonymous)</author>
<category domain="https://hdchina.org/torrents.php?cat=410">4K UltraHD</category>
<comments>
<![CDATA[ https://hdchina.org/details.php?id=587937&cmtpage=0#startcomments ]]>
</comments>
<enclosure url="https://hdchina.org/download.php?hash=le8sC4McW5ZgQ8-RayR79w&uid=325966" length="65668782012" type="application/x-bittorrent"/>
<guid isPermaLink="false">0cfcf4977f131bd435b9489dc00fe7f00979a064</guid>
<pubDate>Mon, 11 Apr 2022 14:23:59 +0800</pubDate>
</item>
</channel>
</rss>
`;
