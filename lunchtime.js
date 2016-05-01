var fs = require('fs');

var AsciiTable = require('ascii-table');
var async = require('async');
var cheerio = require("cheerio");
var charset = require('charset');
var iconv = require('iconv');
var jschardet = require('jschardet');
var moment = require('moment');
var request = require('request').defaults({ jar: true });
var tidy = require('htmltidy').tidy;

var url = 'http://extranet.novae-restauration.ch/novae/traiteur/restauration/restaurant-cern.html?frame=1';

var startOfWeek = moment().startOf('isoWeek').format("YYYY-MM-DD");
var weekCacheFilename = "data/" + startOfWeek + ".json";
var today = moment();
if (today.isoWeekday() >= 6) {
  // Adjust today to next Monday if Saturday or Sunday
  today = today.add(8 - today.isoWeekday(), "days");  
}

var args = process.argv.slice(2);
if (args.length > 0) {
  today = today.isoWeekday(parseInt(args[0]));
}

var menu;
try {
  menu = JSON.parse(fs.readFileSync(weekCacheFilename));
  printMenu(menu);
  process.exit();
} catch (e) {
  if (e.code != 'ENOENT') {
    throw e;
  }
  console.log("Nothing in cache.");
}

// Fetch week menu
async.waterfall([
  function getMainPage(callback) {
    request('http://cern.ch/resto1', function(error, response, body) {
      callback(null, url + "&" + response.request.uri.query);
    });
  },
  function getMenuFrame(frameUrl, callback) {
    request(frameUrl, function(error, response, body) {
      callback(null);
    });
  },
  function getMenuPages(callback) {
    async.map([1, 2, 3], getMenuForPage, callback);
  }
],
function mergePageResults(err, results) {
  var weekMenu = results[0];
  for (var day in weekMenu) {
    [1, 2].forEach(function (el) {
      weekMenu[day] = (weekMenu[day]||[]).concat(results[el][day]);
    });
  }
  printMenu(weekMenu);
  fs.writeFile(weekCacheFilename, JSON.stringify(weekMenu, null, 4), 'utf8');
});

function getMenuForPage(page, callback) {
  console.time("getMenuForPage " + page);
  var pageLimit = { 1:0, 2:3, 3:5 };
  request.post({
    url: url,
    form: {
      "fn_limite": pageLimit[page],
      "fn_numpage": page,
      "fn_jourSemaine": today.format("YYYY-MM-DD"),
      "fn_refresh": "1",
      "fn_changeType": "2",
      "fa_afficheSemaine_menurestaurant": "Page " + page
    },
    encoding: 'binary'
  },     
  function(error, response, body) {
    console.timeEnd("getMenuForPage " + page);
    var enc = charset(response.headers, body);
    enc = enc || jchardet.detect(body).encoding.toLowerCase();
    if (enc != 'utf-8') {
      var converter = new iconv.Iconv(enc, 'UTF-8//TRANSLIT//IGNORE');
      body = converter.convert(new Buffer(body, 'binary')).toString('utf-8');
    }
    tidy(body, function(err, html) {
      callback(null, parseMenuForPage(html));
    });
  });
}

function parseMenuForPage(html) {
  var menu = {};
  var $ = cheerio.load(html);
  var types = $(".typeMenu").map(function () { return $(this).text(); }).get();
  var days = $(".EnteteMenu");

  days.each(function(i, el) {
    var dailyMenu = [];
    var day = $(this).text().replace(/\r\n/g, " ");
    var options = $(this).parent().next().children("td");

    options.each(function(i, el) {
      var option = $(this);
      var description = option.find("span").text();
      var price = option.find("center").text().trim();
      dailyMenu.push({ 
        type: types[i].replace(/\r\n/g, " "),
        description: description ? description.replace(/\r\n/g, " ") : "N/A",
        price: price.replace(/\r\n/g, " ")
      });
    });

    menu[day] = dailyMenu;
  });

  return menu;
}

function printMenu(menu) {
  var table = new AsciiTable();
  var days = Object.keys(menu);
  var types = {};
  var todayWeekday = today.isoWeekday() - 1;

  table.setHeading([''].concat(days[todayWeekday]));
  [days[todayWeekday]].forEach(function(day, i) {
    var options = menu[day];
    options.forEach(function(option) {
      var descr = option.description + " (" + option.price + ")";
      types[option.type] = (types[option.type]||[option.type]).concat(descr);
    });
  });

  for (var type in types) {
    table.addRow(types[type]);
  }

  console.log(table.toString());
}