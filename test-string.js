const Transmission = require('transmission');
const transmission = new Transmission({
  host: 'home.perterpon.com',
  port: 9091,
  username: 'perterpon', 
  password: 'pon423904',
  ssl: false
});

// transmission.addUrl('http://cdn-pt.perterpon.com/hdchina/269592/mteam_578991.torrent', {
//   'download-dir': '/volume1/homes/download/pt/3333'
// }, (e, e2) => {
//   console.log(e, e2);
// });

transmission.get([0,1109,1110,1117,1118,1119,1120,1121,1122,1123,1124,1125,1126,1127,1128,1129,1130,1131,1132,1133,1134,1135,1136,1137,1138,1139,1140,1141,1142,1143,1144,1145,1146,1147,1148,1149,1150,1151,1152,1153,1154,1155,1156,1157,1158,1159,1155,1156,1157,1158,1159,1160,1161,1162,1163,1164,1160,1161,1162,1163,1164,1160,1161,1162,1163,1164,1165,1166,1167,1168,1169,1165,1166,1167,1168,1169,1165,1166,1167,1168,1169,1170,1171,1172,1173,1174,1170,1171,1172,1173,1174,1170,1171,1172,1173,1174,1175,1176,1177,1178,1179,1180,1181,1182,1183,1184,1185,1186,1187,1188,1189,1190,1191,1192,1193,1194,1195,1196,1197,1198,1199,1195,1196,1197,1198,1199,1195,1196,1197,1198,1199,1200,1001,1201,1202,1203,1204,1205,995,1035,1034,1206,1032,1207,1030,1208,1100,1099,1098,1209,1210,1211,1212,1213,1214,1215,1216,1217,1218,1219,1220,1221,1223,1224,1225,1226,1227,1228,1229,1230,1231,1232,1233,1234,1235,1236,1237,1238,1239,1240,1236,1237,1238,1239,1240,1241,1242,1243,1244,1245,1241,1242,1243,1244,1245,1246,1247,1248,1249,1250,1246,1247,1248,1249,1250,1251,1252,1253,1254,1255,1251,1252,1253,1254,1255,1256,1257,1258,1259,1260,1261,1262,1264,1265,1266,1267,1268,1269,1270,1271,1272,1016,1274,1275,1276,1277,1278,1279,1280,1281,1282,1283,1284,1285,1286,1287], (error, data) => {
  console.log(data);
});
// transmission.freeSpace('/Volumes/pt',(error, data) => {
//   console.log(data);
// });

// transmission.addUrl('http://cdn-pt.perterpon.com/hdchina/325966/hdchina_608432.torrent', function(error, data) {
//   console.log(transmission.status, data);
  // data
  // {
  //   hashString: '228c44513eb836b8c621d1408ceb3030262eac53',
  //   id: 595,
  //   name: 'Harry.Potter.and.the.Goblet.of.Fire.2005.2160p.UHD.BluRay.HDR.x265.DTS-HD.MA7.1'
  // }
// });



// const mysql = require('mysql2');

// const connection = mysql.createConnection({
//   host: 'home.perterpon.com',
//   user: 'pt',
//   password: 'hello1234',
//   database: 'pt'
// });

// connection.query('select * from torrent', (error, data) => {
//   console.log(error, data);
// });
