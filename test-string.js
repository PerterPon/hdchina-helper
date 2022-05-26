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

// transmission.active((error, data) => {
//   console.log(data);
// });
transmission.freeSpace('/volume1/homes/download/pt/mteam/269592',(error, data) => {
  console.log(data);
});

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
