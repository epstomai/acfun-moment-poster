// ==UserScript==
// @name         acfun统计
// @namespace    acfun-moment-poster
// @description  AcFun 个人中心礼物统计（对齐 ACFun-Live-Helper 界面与数据逻辑）
// @author       syachiku
// @match        https://www.acfun.cn/member
// @match        https://www.acfun.cn/member/*
// @run-at       document-start
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @grant        GM_cookie
// @grant        GM.cookie.list
// @connect      api-ipv6.app.acfun.cn
// @connect      www.acfun.cn
// @connect      acfun.cn
// @version      0.2.1.8
// @license      MIT
// @require      https://cdn.jsdelivr.net/npm/vue@2.6.12/dist/vue.min.js
// @require      https://cdn.jsdelivr.net/npm/echarts@5.0.2/dist/echarts.min.js
// @require      https://cdn.jsdelivr.net/npm/exceljs@4.2.1/dist/exceljs.min.js
// @require      https://cdn.jsdelivr.net/npm/file-saver@2.0.2/dist/FileSaver.min.js
// ==/UserScript==

(function () {
    'use strict';

    var GIFT_STATS_FULL_PAGE_LIMIT = 300;
    var GIFT_STATS_AUTO_PAGE_LIMIT = 50;
    var GIFT_STATS_AUTO_RECORD_LIMIT = 2000;
    var GIFT_STATS_AUTO_TIME_LIMIT_MS = 8000;
    var STORAGE_KEY = 'acfun_stat_gift_v1';
    var STAT_NAV_ID = 'acfun-stat-nav-item';
    var LOG_PREFIX = '[acfun统计]';
    var DEBUG_STAT = true;

    var API_BASE = 'https://api-ipv6.app.acfun.cn';
    var URL_GIVE = API_BASE + '/rest/apph5-direct/pay/reward/giveRecords';
    var URL_RECEIVE = API_BASE + '/rest/apph5-direct/pay/reward/receiveRecords';
    var BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

    var statVue = null;
    var statNavItem = null;
    var statNavObserver = null;
    var statNavBoundEles = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
    var statNavBoundFallback = [];

    GM_addStyle(`
        #acfunstat-root {
            --line: #ececec;
            --line-2: #f3f3f3;
            --card: #fff;
            --field: #f6f6f6;
            --hover: #fafafa;
            --ink: #222;
            --ink-2: #555;
            --ink-3: #888;
            --acc: #fd4c5d;
            --acc-soft: #fff5f6;
            --good: #23a35a;
            --font-mono: Consolas, Monaco, monospace;
            padding: 20px 24px 32px;
            color: var(--ink);
            font-size: 14px;
            line-height: 1.5;
            box-sizing: border-box;
        }
        #acfunstat-root *, #acfunstat-root *::before, #acfunstat-root *::after { box-sizing: border-box; }
        #acfunstat-root[v-cloak] { display: none; }
        #acfunstat-root .kicker { font-size: 11px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; color: var(--acc); }
        #acfunstat-root .scr-title { margin: 6px 0 0; font-size: 24px; font-weight: 700; }
        #acfunstat-root .scr-sub { margin: 6px 0 0; color: var(--ink-3); font-size: 13px; }
        #acfunstat-root .stat-tabs { margin: 14px 0 4px; }
        #acfunstat-root .gift-toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 16px 0; }
        #acfunstat-root .seg { display: inline-flex; gap: 3px; padding: 3px; border-radius: 11px; background: var(--field); border: 1px solid var(--line); }
        #acfunstat-root .seg button { height: 30px; padding: 0 16px; border: none; border-radius: 8px; font-size: 12.5px; font-weight: 600; color: var(--ink-3); background: transparent; cursor: pointer; transition: .2s; }
        #acfunstat-root .seg button:hover { color: var(--ink); }
        #acfunstat-root .seg button.on { background: var(--card); color: var(--ink); box-shadow: 0 1px 4px rgba(0,0,0,.12); }
        #acfunstat-root .btn-s { height: 34px; padding: 0 16px; border-radius: 10px; border: 1px solid var(--line); background: var(--card); font-size: 13px; font-weight: 600; cursor: pointer; }
        #acfunstat-root .btn-s.primary { background: var(--acc); border-color: var(--acc); color: #fff; }
        #acfunstat-root .btn-s:disabled { opacity: .55; cursor: not-allowed; }
        #acfunstat-root .status-box { margin: 12px 0; padding: 10px 12px; border-radius: 10px; background: var(--field); color: var(--ink-2); font-size: 13px; }
        #acfunstat-root .status-box.err { background: #fff1f0; color: #c0392b; }
        #acfunstat-root .status-box.limited { background: #fffbe6; color: #8a6d00; }
        #acfunstat-root .st-kpis { margin: 0 0 16px; display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; }
        @media (max-width: 720px) { #acfunstat-root .st-kpis { grid-template-columns: 1fr; } }
        #acfunstat-root .kpi { display: grid; gap: 7px; padding: 15px 17px; border: 1px solid var(--line); border-radius: 14px; background: var(--card); }
        #acfunstat-root .kpi-k { font-size: 11.5px; font-weight: 600; color: var(--ink-3); }
        #acfunstat-root .kpi-v { font-family: var(--font-mono); font-size: 23px; font-weight: 700; line-height: 1; }
        #acfunstat-root .card2 { border: 1px solid var(--line); border-radius: 16px; background: var(--card); overflow: hidden; margin-top: 16px; }
        #acfunstat-root .card2-h { display: flex; align-items: center; gap: 10px; padding: 13px 15px; border-bottom: 1px solid var(--line); }
        #acfunstat-root .c2t { font-size: 14.5px; font-weight: 700; }
        #acfunstat-root .c2cnt { margin-left: auto; font-size: 11.5px; color: var(--ink-3); }
        #acfunstat-root .rank-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 16px; margin-top: 16px; }
        @media (max-width: 960px) { #acfunstat-root .rank-grid { grid-template-columns: 1fr; } }
        #acfunstat-root .alist { max-height: 380px; overflow: auto; padding: 8px; }
        #acfunstat-root .arow { display: flex; align-items: center; gap: 11px; padding: 9px 8px; border-radius: 10px; }
        #acfunstat-root .arow:hover { background: var(--hover); }
        #acfunstat-root .rk { width: 16px; font-family: var(--font-mono); font-size: 12px; font-weight: 700; color: var(--ink-3); text-align: center; flex: none; }
        #acfunstat-root .rk.t { color: var(--acc); }
        #acfunstat-root .aav { width: 30px; height: 30px; border-radius: 50%; background: var(--acc-soft); color: var(--acc); display: grid; place-items: center; font-size: 12px; font-weight: 700; flex: none; }
        #acfunstat-root .am { display: grid; gap: 1px; min-width: 0; flex: 1; }
        #acfunstat-root .am b { font-size: 13px; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        #acfunstat-root .am span { font-size: 10px; color: var(--ink-3); font-family: var(--font-mono); }
        #acfunstat-root .amt { font-family: var(--font-mono); font-size: 13px; font-weight: 700; color: var(--ink); flex: none; }
        #acfunstat-root .gift-table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
        #acfunstat-root .gift-table th, #acfunstat-root .gift-table td { padding: 10px 12px; border-bottom: 1px solid var(--line-2); text-align: left; }
        #acfunstat-root .gift-table th { font-size: 11px; color: var(--ink-3); font-weight: 700; }
        #acfunstat-root .mono { font-family: var(--font-mono); }
        #acfunstat-root .empty-row { padding: 24px 16px; text-align: center; color: var(--ink-3); font-size: 13px; }
        #acfunstat-root a.user-link { color: var(--acc); text-decoration: none; }
        #acfunstat-root a.user-link:hover { text-decoration: underline; }
        #acfunstat-root .trend-toolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-left: auto; }
        #acfunstat-root .trend-toolbar select { height: 32px; padding: 0 10px; border-radius: 8px; border: 1px solid var(--line); background: var(--card); font-size: 12.5px; color: var(--ink); }
        #acfunstat-root .trend-toolbar a { font-size: 12.5px; font-weight: 600; color: var(--acc); text-decoration: none; }
        #acfunstat-root .trend-toolbar a:hover { text-decoration: underline; }
        #acfunstat-root #gift-trend-container { height: 220px; width: 100%; margin-top: 8px; }
        #acfunstat-root .detail-drawer { position: fixed; inset: 0; z-index: 99999; display: flex; }
        #acfunstat-root .detail-drawer .backdrop { flex: 1; background: rgba(0,0,0,.35); }
        #acfunstat-root .detail-panel { width: min(720px, 92vw); background: var(--card); box-shadow: -4px 0 24px rgba(0,0,0,.12); display: flex; flex-direction: column; max-height: 100vh; }
        #acfunstat-root .detail-panel-h { display: flex; align-items: center; gap: 10px; padding: 14px 16px; border-bottom: 1px solid var(--line); }
        #acfunstat-root .detail-panel-h b { flex: 1; font-size: 15px; }
        #acfunstat-root .detail-panel-h button { border: none; background: transparent; font-size: 22px; line-height: 1; cursor: pointer; color: var(--ink-3); }
        #acfunstat-root .detail-panel-b { overflow: auto; padding: 8px 12px 16px; }
    `);

    function statLog() {
        if (!DEBUG_STAT) return;
        var args = ['%c' + LOG_PREFIX, 'color:#fd4c5d;font-weight:bold;'].concat([].slice.call(arguments));
        console.log.apply(console, args);
    }

    function statWarn() {
        if (!DEBUG_STAT) return;
        console.warn.apply(console, [LOG_PREFIX].concat([].slice.call(arguments)));
    }

    function getCookie(name) {
        var m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
        return m ? decodeURIComponent(m[1]) : '';
    }

    function isLoggedIn() {
        return !!(getCookie('auth_key') || getCookie('userId'));
    }

    function formatDateTimeLocal(date) {
        if (!(date instanceof Date) || isNaN(date.getTime())) return '';
        var y = date.getFullYear();
        var mo = String(date.getMonth() + 1).padStart(2, '0');
        var d = String(date.getDate()).padStart(2, '0');
        var h = String(date.getHours()).padStart(2, '0');
        var mi = String(date.getMinutes()).padStart(2, '0');
        return y + '-' + mo + '-' + d + 'T' + h + ':' + mi;
    }

    function getThisMonthRange() {
        var now = new Date();
        var start = new Date(now.getFullYear(), now.getMonth(), 1);
        start.setHours(0, 0, 0, 0);
        return { start: formatDateTimeLocal(start), end: formatDateTimeLocal(now) };
    }

    function getFullCalendarMonthRange() {
        var now = new Date();
        var start = new Date(now.getFullYear(), now.getMonth(), 1);
        start.setHours(0, 0, 0, 0);
        var end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
        end.setHours(23, 59, 0, 0);
        return {
            start: formatDateTimeLocal(start),
            end: formatDateTimeLocal(end),
            label: formatYMD(start) + ' 至 ' + formatYMD(end),
            monthKey: formatYM(start),
        };
    }

    function parseDateTimeLocal(value, includeMinuteEnd) {
        var text = String(value || '').trim();
        if (!text) return 0;
        var parsed = Date.parse(text);
        if (!isFinite(parsed)) return 0;
        return includeMinuteEnd ? parsed + 59999 : parsed;
    }

    function minuteEndTimestamp(ts) {
        var n = Number(ts || Date.now());
        return Math.floor(n / 60000) * 60000 + 59999;
    }

    function parseGiftRecordTime(record) {
        var value = record && record.createTime;
        if (value === undefined || value === null || value === '') return 0;
        var number = Number(value);
        if (isFinite(number)) return number > 9999999999 ? number : number * 1000;
        var parsed = Date.parse(String(value));
        return isFinite(parsed) ? parsed : 0;
    }

    function formatRecordTime(value) {
        var ts = typeof value === 'number' && value > 9999999999 ? value : parseGiftRecordTime({ createTime: value });
        if (!ts) return '—';
        var d = new Date(ts);
        var y = d.getFullYear();
        var mo = String(d.getMonth() + 1).padStart(2, '0');
        var da = String(d.getDate()).padStart(2, '0');
        var h = String(d.getHours()).padStart(2, '0');
        var mi = String(d.getMinutes()).padStart(2, '0');
        var s = String(d.getSeconds()).padStart(2, '0');
        return y + '-' + mo + '-' + da + ' ' + h + ':' + mi + ':' + s;
    }

    function displayCount(value) {
        var n = Number(value);
        if (!isFinite(n)) return String(value == null ? '—' : value);
        if (n >= 10000) return (n / 10000).toFixed(1).replace(/\.0$/, '') + '万';
        return n.toLocaleString();
    }

    function giftStatsRange(gs) {
        var start = parseDateTimeLocal(gs.dateRangeStart);
        var end = parseDateTimeLocal(gs.dateRangeEnd, true);
        if (start && end && start > end) {
            var tmp = start;
            start = end;
            end = tmp;
        }
        return { active: !!(start || end), start: start, end: end };
    }

    function isGiftRecordInRange(record, range) {
        if (!range.active) return true;
        var time = parseGiftRecordTime(record);
        if (!time) return false;
        if (range.start && time < range.start) return false;
        if (range.end && time > range.end) return false;
        return true;
    }

    function buildGiftStatsSummary(sendRecords, receiveRecords, range) {
        var sendMap = {};
        var recvMap = {};
        var sendAcoinTotal = 0;
        var receiveDiamondTotal = 0;
        var receivePeachTotal = 0;

        function touch(map, r) {
            var uid = String(r.userId);
            if (!map[uid]) {
                map[uid] = { uid: uid, userName: r.userName || uid, acoin: 0, diamond: 0, peach: 0 };
            }
            if (!map[uid].userName && r.userName) map[uid].userName = r.userName;
            return map[uid];
        }

        sendRecords.forEach(function (r) {
            if (!isGiftRecordInRange(r, range)) return;
            var acoin = Number(r.acoin) || 0;
            sendAcoinTotal += acoin;
            touch(sendMap, r).acoin += acoin;
        });

        receiveRecords.forEach(function (r) {
            if (!isGiftRecordInRange(r, range)) return;
            var u = touch(recvMap, r);
            if (r.giftName === '桃子') {
                var peach = Number(r.giftCount) || 0;
                u.peach += peach;
                receivePeachTotal += peach;
            } else {
                var diamond = Number(r.azuanAmount) || 0;
                u.diamond += diamond;
                receiveDiamondTotal += diamond;
            }
        });

        function toRank(map, field) {
            return Object.keys(map).map(function (k) { return map[k]; })
                .filter(function (u) { return u[field] > 0; })
                .sort(function (a, b) { return b[field] - a[field]; })
                .slice(0, 100);
        }

        return {
            sendAcoinTotal: sendAcoinTotal,
            receiveDiamondTotal: receiveDiamondTotal,
            receivePeachTotal: receivePeachTotal,
            sendRank: toRank(sendMap, 'acoin'),
            peachRank: toRank(recvMap, 'peach'),
            contribRank: toRank(recvMap, 'diamond'),
        };
    }

    function buildPeachMonthSummary(receiveRecords, range) {
        var map = {};
        var peachTotal = 0;
        var recent = [];

        receiveRecords.forEach(function (r) {
            if (!isGiftRecordInRange(r, range)) return;
            if (r.giftName !== '桃子') return;
            var peach = Number(r.giftCount) || 0;
            if (!peach) return;
            peachTotal += peach;
            var uid = String(r.userId);
            if (!map[uid]) map[uid] = { uid: uid, userName: r.userName || uid, peach: 0 };
            if (!map[uid].userName && r.userName) map[uid].userName = r.userName;
            map[uid].peach += peach;
            recent.push({
                time: formatRecordTime(r.createTime),
                nickname: r.userName,
                count: peach,
                userId: uid,
                sortTime: parseGiftRecordTime(r),
            });
        });

        var peachRank = Object.keys(map).map(function (k) { return map[k]; })
            .filter(function (u) { return u.peach > 0; })
            .sort(function (a, b) { return b.peach - a.peach; });

        recent.sort(function (a, b) { return b.sortTime - a.sortTime; });
        return {
            peachTotal: peachTotal,
            peachRank: peachRank,
            recentPeachRecords: recent.slice(0, 50),
        };
    }

    function buildReceiveRanking(contribRank) {
        return (contribRank || []).slice(0, 20).map(function (u) {
            return {
                userId: u.uid,
                nickname: u.userName,
                totalAmount: u.diamond,
            };
        });
    }

    function formatYMD(date) {
        var y = date.getFullYear();
        var mo = String(date.getMonth() + 1).padStart(2, '0');
        var d = String(date.getDate()).padStart(2, '0');
        return y + '-' + mo + '-' + d;
    }

    function formatYM(date) {
        return date.getFullYear() + '-' + String(date.getMonth() + 1).padStart(2, '0');
    }

    function recordTimeUnitKey(record, unit) {
        var ts = parseGiftRecordTime(record);
        if (!ts) return '';
        var date = new Date(ts);
        if (unit === 'day') return formatYMD(date);
        if (unit === 'month') return formatYM(date);
        if (unit === 'year') return String(date.getFullYear());
        if (unit === 'week') {
            var monday = new Date(date);
            monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
            monday.setHours(0, 0, 0, 0);
            return formatYMD(monday);
        }
        return '';
    }

    function filterRecordsInRange(records, range) {
        return (records || []).filter(function (r) { return isGiftRecordInRange(r, range); });
    }

    function uniqueUsersFromRecords(records) {
        var map = {};
        records.forEach(function (r) {
            var uid = String(r.userId);
            if (!map[uid]) map[uid] = { uid: uid, userName: r.userName || uid };
            else if (!map[uid].userName && r.userName) map[uid].userName = r.userName;
        });
        return Object.keys(map).map(function (k) { return map[k]; })
            .sort(function (a, b) { return String(a.userName).localeCompare(String(b.userName)); });
    }

    function sumRecordField(records, field) {
        return records.reduce(function (sum, r) { return sum + (Number(r[field]) || 0); }, 0);
    }

    function formatFileDate() {
        return formatYMD(new Date());
    }

    function excelBorderRow(sheet, rowIndex, colCount, header) {
        var row = sheet.getRow(rowIndex);
        for (var i = 1; i <= colCount; i++) {
            var cell = row.getCell(i);
            if (header) cell.alignment = { vertical: 'middle', horizontal: 'center' };
            cell.border = {
                top: { style: 'thin' },
                left: { style: 'thin' },
                bottom: { style: 'thin' },
                right: { style: 'thin' },
            };
        }
    }

    function buildRecentRecords(sendRecords, receiveRecords, range) {
        var items = [];
        sendRecords.forEach(function (r) {
            if (!isGiftRecordInRange(r, range)) return;
            items.push({
                time: formatRecordTime(r.createTime),
                nickname: r.userName,
                giftName: r.giftName,
                count: r.giftCount,
                direction: 'send',
                sortTime: parseGiftRecordTime(r),
            });
        });
        receiveRecords.forEach(function (r) {
            if (!isGiftRecordInRange(r, range)) return;
            items.push({
                time: formatRecordTime(r.createTime),
                nickname: r.userName,
                giftName: r.giftName,
                count: r.giftCount,
                direction: 'receive',
                sortTime: parseGiftRecordTime(r),
            });
        });
        return items.sort(function (a, b) { return b.sortTime - a.sortTime; }).slice(0, 30);
    }

    function giftStatsCacheStart(sendRecords, receiveRecords) {
        var start = 0;
        [sendRecords, receiveRecords].forEach(function (records) {
            records.forEach(function (record) {
                var time = parseGiftRecordTime(record);
                if (time && (!start || time < start)) start = time;
            });
        });
        return start;
    }

    function isGiftStatsRangeCoveredByCache(gs, range) {
        if (!gs.fetchedAt) return false;
        if (!range.active) return !!gs.cacheComplete;
        var cacheStart = Number(gs.cacheRangeStart) || 0;
        var cacheEnd = Number(gs.cacheRangeEnd || gs.fetchedAt) || 0;
        if (!gs.cacheComplete && !cacheStart) return false;
        if (!gs.cacheComplete && !range.start) return false;
        if (!gs.cacheComplete && range.start && cacheStart && range.start < cacheStart) return false;
        if (range.end && cacheEnd && range.end > cacheEnd) return false;
        return true;
    }

    function listAcfunCookies() {
        return new Promise(function (resolve) {
            if (typeof GM !== 'undefined' && GM.cookie && GM.cookie.list) {
                GM.cookie.list({ domain: 'acfun.cn' }).then(function (c) { resolve(c || []); }).catch(function () { resolve([]); });
                return;
            }
            if (typeof GM_cookie !== 'undefined' && GM_cookie.list) {
                GM_cookie.list({ domain: 'acfun.cn' }, function (c, err) { resolve(err ? [] : (c || [])); });
                return;
            }
            resolve([]);
        });
    }

    function cookiesToHeader(cookies) {
        var map = {};
        (cookies || []).forEach(function (c) {
            if (c && c.name) map[c.name] = c.value;
        });
        var did = getCookie('_did');
        if (did) map._did = did;
        return Object.keys(map).map(function (name) { return name + '=' + map[name]; }).join('; ');
    }

    function buildAcfunCookieHeader() {
        return listAcfunCookies().then(function (cookies) {
            var header = cookiesToHeader(cookies);
            return header || document.cookie || '';
        });
    }

    function gmRequest(options) {
        return new Promise(function (resolve, reject) {
            GM_xmlhttpRequest({
                method: options.method || 'GET',
                url: options.url,
                headers: options.headers || {},
                anonymous: !!options.anonymous,
                timeout: options.timeout || 30000,
                onload: resolve,
                onerror: function () { reject(new Error('网络请求失败')); },
                ontimeout: function () { reject(new Error('请求超时')); },
            });
        });
    }

    function rewardHeaders(cookieHeader) {
        var headers = {
            Accept: 'application/json',
            Referer: 'https://www.acfun.cn/',
            'User-Agent': BROWSER_UA,
        };
        if (cookieHeader) headers.cookie = cookieHeader;
        return headers;
    }

    function requestRewardPage(url, cookieHeader, label) {
        statLog('rewardRecords/' + label, url);
        return gmRequest({
            method: 'GET',
            url: url,
            headers: rewardHeaders(cookieHeader),
            anonymous: false,
        }).then(function (res) {
            statLog('rewardRecords 响应/' + label, { status: res.status, preview: String(res.responseText || '').slice(0, 200) });
            if (res.status !== 200) throw new Error('HTTP ' + res.status);
            var data = JSON.parse(res.responseText);
            if (data.result !== 0) throw new Error(data.error_msg || ('接口错误(' + data.result + ')'));
            return data;
        });
    }

    function fetchRewardPage(kind, pcursor) {
        var base = kind === 'receive' ? URL_RECEIVE : URL_GIVE;
        var url = base + '?pcursor=' + encodeURIComponent(pcursor || '0');
        return requestRewardPage(url, null, 'auto').catch(function (err) {
            statWarn('auto-cookie 失败，GM_cookie 重试', err && err.message);
            return buildAcfunCookieHeader().then(function (header) {
                if (!header) throw new Error('缺少登录 Cookie');
                return requestRewardPage(url, header, 'gm-cookie');
            });
        });
    }

    function loadSavedGiftStats() {
        try {
            return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        } catch (e) {
            return {};
        }
    }

    function saveGiftStats(gs) {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            dateRangeStart: gs.dateRangeStart,
            dateRangeEnd: gs.dateRangeEnd,
            preset: gs.preset,
        }));
    }

    function createDefaultGiftStats() {
        var saved = loadSavedGiftStats();
        var month = getThisMonthRange();
        return {
            loading: false,
            loaded: false,
            error: '',
            progress: '',
            preset: saved.preset || 'month',
            dateRangeStart: saved.dateRangeStart || month.start,
            dateRangeEnd: saved.dateRangeEnd || month.end,
            sendRecords: [],
            receiveRecords: [],
            fetchedAt: 0,
            cacheRangeStart: 0,
            cacheRangeEnd: 0,
            cacheComplete: false,
            pagesRead: 0,
            totalRecords: 0,
            limited: false,
            limitReason: '',
            sendAcoinTotal: 0,
            receiveDiamondTotal: 0,
            receivePeachTotal: 0,
            sendRank: [],
            peachRank: [],
            contribRank: [],
            receiveRanking: [],
            recentRecords: [],
        };
    }

    function applyGiftStatsFilter(gs) {
        var range = giftStatsRange(gs);
        var summary = buildGiftStatsSummary(gs.sendRecords, gs.receiveRecords, range);
        gs.sendAcoinTotal = summary.sendAcoinTotal;
        gs.receiveDiamondTotal = summary.receiveDiamondTotal;
        gs.receivePeachTotal = summary.receivePeachTotal;
        gs.sendRank = summary.sendRank;
        gs.peachRank = summary.peachRank;
        gs.contribRank = summary.contribRank;
        gs.receiveRanking = buildReceiveRanking(summary.contribRank);
        gs.recentRecords = buildRecentRecords(gs.sendRecords, gs.receiveRecords, range);
        gs.loaded = gs.fetchedAt > 0;
    }

    function fetchAllRewardRecords(kind, automatic, stats, onProgress) {
        var allRecords = [];
        var pcursor = '0';
        var pages = 0;
        var startedAt = Date.now();

        function limitBy(reason) {
            stats.limited = true;
            stats.limitReason = reason;
        }

        return (function loop() {
            if (pcursor === 'no_more' || pages >= GIFT_STATS_FULL_PAGE_LIMIT) {
                if (pcursor !== 'no_more' && pages >= GIFT_STATS_FULL_PAGE_LIMIT) {
                    limitBy('已达到单类记录 ' + GIFT_STATS_FULL_PAGE_LIMIT + ' 页安全上限');
                }
                return Promise.resolve(allRecords);
            }
            if (automatic && stats.pages >= GIFT_STATS_AUTO_PAGE_LIMIT) {
                limitBy('自动统计已暂停：已读取 ' + GIFT_STATS_AUTO_PAGE_LIMIT + ' 页');
                return Promise.resolve(allRecords);
            }
            if (automatic && stats.records >= GIFT_STATS_AUTO_RECORD_LIMIT) {
                limitBy('自动统计已暂停：已读取 ' + GIFT_STATS_AUTO_RECORD_LIMIT + ' 条记录');
                return Promise.resolve(allRecords);
            }
            if (automatic && Date.now() - startedAt >= GIFT_STATS_AUTO_TIME_LIMIT_MS) {
                limitBy('自动统计已暂停：读取时间超过 8 秒');
                return Promise.resolve(allRecords);
            }
            return fetchRewardPage(kind, pcursor).then(function (data) {
                var records = Array.isArray(data.records) ? data.records : [];
                allRecords = allRecords.concat(records);
                pcursor = data.pcursor || 'no_more';
                pages += 1;
                stats.pages += 1;
                stats.records += records.length;
                if (onProgress) onProgress(kind, pages, records.length);
                if (records.length === 0 && pcursor !== 'no_more') return allRecords;
                return loop();
            });
        })();
    }

    function loadGiftStats(gs, automatic) {
        var stats = { pages: 0, records: 0, limited: false, limitReason: '' };
        gs.loading = true;
        gs.error = '';
        gs.limited = false;
        gs.limitReason = '';
        gs.progress = '准备中…';

        function onProgress(kind, pages) {
            gs.progress = (kind === 'give' ? '送出' : '收到') + '记录已读取 ' + pages + ' 页…';
        }

        return fetchAllRewardRecords('give', automatic, stats, onProgress)
            .then(function (sendRecords) {
                if (automatic && stats.limited) return { sendRecords: sendRecords, receiveRecords: [] };
                return fetchAllRewardRecords('receive', automatic, stats, onProgress).then(function (receiveRecords) {
                    return { sendRecords: sendRecords, receiveRecords: receiveRecords };
                });
            })
            .then(function (result) {
                gs.sendRecords = result.sendRecords;
                gs.receiveRecords = result.receiveRecords;
                gs.fetchedAt = Date.now();
                gs.cacheRangeStart = giftStatsCacheStart(result.sendRecords, result.receiveRecords);
                gs.cacheRangeEnd = minuteEndTimestamp(gs.fetchedAt);
                gs.cacheComplete = !stats.limited;
                gs.pagesRead = stats.pages;
                gs.totalRecords = stats.records;
                gs.limited = stats.limited;
                gs.limitReason = stats.limitReason;
                applyGiftStatsFilter(gs);
                gs.progress = '';
                statLog('礼物统计完成', {
                    send: gs.sendAcoinTotal,
                    diamond: gs.receiveDiamondTotal,
                    peach: gs.receivePeachTotal,
                    records: gs.totalRecords,
                    limited: gs.limited,
                });
            })
            .catch(function (error) {
                gs.error = (error && error.message) || String(error);
                statWarn('礼物统计失败', gs.error);
                throw error;
            })
            .finally(function () {
                gs.loading = false;
            });
    }

    function createDefaultPeachStats() {
        var month = getFullCalendarMonthRange();
        return {
            dateRangeStart: month.start,
            dateRangeEnd: month.end,
            rangeLabel: month.label,
            monthKey: month.monthKey,
            loaded: false,
            peachTotal: 0,
            peachRank: [],
            recentPeachRecords: [],
        };
    }

    function syncPeachMonthState(gs, ps) {
        var month = getFullCalendarMonthRange();
        ps.dateRangeStart = month.start;
        ps.dateRangeEnd = month.end;
        ps.rangeLabel = month.label;
        ps.monthKey = month.monthKey;
        ps.loaded = gs.fetchedAt > 0;
        var range = giftStatsRange(ps);
        var summary = buildPeachMonthSummary(gs.receiveRecords || [], range);
        ps.peachTotal = summary.peachTotal;
        ps.peachRank = summary.peachRank;
        ps.recentPeachRecords = summary.recentPeachRecords;
    }

    function presetRange(preset) {
        var now = new Date();
        var start;
        if (preset === 'month') {
            start = new Date(now.getFullYear(), now.getMonth(), 1);
            start.setHours(0, 0, 0, 0);
        } else if (preset === 'week') {
            start = new Date(now);
            var day = start.getDay() || 7;
            start.setDate(start.getDate() - day + 1);
            start.setHours(0, 0, 0, 0);
        } else {
            start = new Date(now.getFullYear(), now.getMonth() - 3, 1);
            start.setHours(0, 0, 0, 0);
        }
        return { start: formatDateTimeLocal(start), end: formatDateTimeLocal(now) };
    }

    function deactivateStatNav(navEle, navItem) {
        if (!navItem) return;
        navItem.classList.remove('router-link-exact-active', 'ac-member-navigation-item-active');
    }

    function isCustomPanelOpen() {
        return !!document.querySelector('#acfunstat-root');
    }

    function isNavEscapeBound(navEle) {
        if (!navEle) return true;
        if (statNavBoundEles) return statNavBoundEles.has(navEle);
        return statNavBoundFallback.indexOf(navEle) >= 0;
    }

    function markNavEscapeBound(navEle) {
        if (!navEle) return;
        if (statNavBoundEles) statNavBoundEles.add(navEle);
        else if (statNavBoundFallback.indexOf(navEle) < 0) statNavBoundFallback.push(navEle);
    }

    function bindMemberNavigationEscape(navEle, navItem) {
        if (!navEle || isNavEscapeBound(navEle)) return;
        markNavEscapeBound(navEle);
        navEle.addEventListener('click', function (e) {
            var item = e.target.closest('.ac-member-navigation-item');
            if (!item || item.id === STAT_NAV_ID) return;
            if (!isCustomPanelOpen()) return;
            var link = item.closest('a[href]') || item;
            var href = link.getAttribute('href');
            if (!href || href === '#' || href.indexOf('javascript:') === 0) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            deactivateStatNav(navEle, document.getElementById(STAT_NAV_ID));
            location.assign(href);
        }, true);
    }

    function createStatNavItem() {
        var navItem = document.createElement('a');
        navItem.id = STAT_NAV_ID;
        navItem.href = 'javascript:void(0)';
        navItem.className = 'ac-member-navigation-item';
        navItem.innerHTML = '<span class="ac-icon"><i class="iconfont">&#xe3ca;</i></span>统计';
        navItem.addEventListener('click', function (e) {
            e.stopPropagation();
            e.preventDefault();
            if (document.querySelector('#acfunstat-root')) return;
            var navEle = document.querySelector('.ac-member-navigation');
            var active = navEle && navEle.querySelector('.router-link-exact-active');
            if (active && active !== navItem) {
                active.classList.remove('router-link-exact-active', 'ac-member-navigation-item-active');
            }
            navItem.classList.add('router-link-exact-active', 'ac-member-navigation-item-active');
            if (statVue) {
                statVue.$destroy();
                statVue = null;
            }
            mountStatPanel();
        });
        return navItem;
    }

    function ensureStatNavItem() {
        var navEle = document.querySelector('.ac-member-navigation');
        if (!navEle) return false;

        var navItem = document.getElementById(STAT_NAV_ID);
        if (!navItem || !navItem.isConnected) {
            if (!statNavItem || statNavItem.id !== STAT_NAV_ID) statNavItem = createStatNavItem();
            navItem = statNavItem;
        } else {
            statNavItem = navItem;
        }

        if (navItem.parentNode !== navEle) {
            navEle.appendChild(navItem);
            statLog('统计导航已（重新）注入');
        }

        bindMemberNavigationEscape(navEle, navItem);
        return true;
    }

    function watchMemberNavigation() {
        if (watchMemberNavigation._started) return;
        watchMemberNavigation._started = true;

        function bindNavObserver(navEle) {
            if (!navEle) return;
            if (statNavObserver && statNavObserver._target === navEle) {
                ensureStatNavItem();
                return;
            }
            if (statNavObserver) statNavObserver.disconnect();
            statNavObserver = new MutationObserver(function () {
                if (!document.getElementById(STAT_NAV_ID)) ensureStatNavItem();
            });
            statNavObserver._target = navEle;
            statNavObserver.observe(navEle, { childList: true });
            ensureStatNavItem();
        }

        var rootObserver = new MutationObserver(function () {
            bindNavObserver(document.querySelector('.ac-member-navigation'));
        });
        rootObserver.observe(document.documentElement, { childList: true, subtree: true });
        bindNavObserver(document.querySelector('.ac-member-navigation'));
    }

    function mountStatPanel() {
        var html = `
            <div id="acfunstat-root" v-cloak>
                <div class="kicker">礼物中心</div>
                <h1 class="scr-title">统计</h1>
                <p class="scr-sub" v-if="activeTab === 'gift'">送出/收到礼物记录与排行</p>
                <p class="scr-sub" v-else>统计范围：{{ ps.rangeLabel }}（自然月 1 日至月末）</p>

                <div class="stat-tabs seg">
                    <button type="button" :class="{ on: activeTab === 'gift' }" @click="setTab('gift')">礼物统计</button>
                    <button type="button" :class="{ on: activeTab === 'peach' }" @click="setTab('peach')">本月桃榜</button>
                </div>

                <div class="gift-toolbar" v-if="activeTab === 'gift'">
                    <div class="seg">
                        <button type="button" :class="{ on: gs.preset === 'month' }" @click="setPreset('month')">本月</button>
                        <button type="button" :class="{ on: gs.preset === 'week' }" @click="setPreset('week')">本周</button>
                        <button type="button" :class="{ on: gs.preset === '3m' }" @click="setPreset('3m')">近3月</button>
                    </div>
                    <button class="btn-s primary" type="button" :disabled="gs.loading || !loggedIn" @click="loadStats(false)">{{ refreshLabel }}</button>
                    <button class="btn-s" type="button" :disabled="!gs.loaded || gs.loading" @click="exportGift">导出 Excel</button>
                </div>
                <div class="gift-toolbar" v-else>
                    <button class="btn-s primary" type="button" :disabled="gs.loading || !loggedIn" @click="loadStats(false)">{{ refreshLabel }}</button>
                    <button class="btn-s" type="button" :disabled="!ps.loaded || gs.loading" @click="exportPeach">导出 Excel</button>
                </div>

                <div v-if="gs.loading" class="status-box">{{ gs.progress || '正在拉取礼物记录…' }}</div>
                <div v-else-if="gs.error" class="status-box err">统计失败：{{ gs.error }}</div>
                <div v-else-if="!gs.loaded" class="status-box">打开本页后会自动统计一次，也可以点击「开始统计」。</div>
                <div v-else-if="statusText" class="status-box" :class="{ limited: gs.limited }">{{ statusText }}</div>

                <template v-if="activeTab === 'gift'">
                <div class="st-kpis" v-if="gs.loaded && !gs.loading">
                    <div class="kpi"><span class="kpi-k">送出 AC币</span><span class="kpi-v mono">{{ displayCount(gs.sendAcoinTotal) }}</span></div>
                    <div class="kpi"><span class="kpi-k">收到钻石</span><span class="kpi-v mono">{{ displayCount(gs.receiveDiamondTotal) }}</span></div>
                    <div class="kpi"><span class="kpi-k">收到桃子</span><span class="kpi-v mono">{{ displayCount(gs.receivePeachTotal) }}</span></div>
                </div>

                <section class="card2" v-if="gs.loaded && !gs.loading">
                    <div class="card2-h">
                        <span class="c2t">{{ switchToSendGiftTrend ? '送出礼物趋势' : '收到礼物趋势' }}</span>
                        <div class="trend-toolbar">
                            <select v-model="giftTrendFormData.unit">
                                <option value="day">按天展示</option>
                                <option value="week">按周展示</option>
                                <option value="month">按月展示</option>
                                <option value="year">按年展示</option>
                            </select>
                            <select v-model="giftTrendFormData.uid">
                                <option value="">不筛选</option>
                                <option v-for="u in trendUserOptions" :key="u.uid" :value="u.uid">{{ u.userName }}</option>
                            </select>
                            <a href="javascript:void(0)" @click="handleSwitchToSendGiftTrend">{{ switchToSendGiftTrend ? '切换至收到礼物趋势' : '切换至送出礼物趋势' }}</a>
                        </div>
                    </div>
                    <div id="gift-trend-container"></div>
                </section>

                <div class="rank-grid" v-if="gs.loaded && !gs.loading">
                    <section class="card2">
                        <div class="card2-h"><span class="c2t">送出排行</span><span class="c2cnt">{{ gs.sendRank.length }} 人</span></div>
                        <div class="alist">
                            <div v-for="(u, i) in gs.sendRank.slice(0, 20)" :key="'s'+u.uid" class="arow">
                                <span class="rk" :class="{ t: i < 3 }">{{ i + 1 }}</span>
                                <span class="aav">{{ (u.userName || '?').slice(0, 1) }}</span>
                                <span class="am"><b><a class="user-link" :href="userUrl(u.uid)" target="_blank">{{ u.userName || '匿名' }}</a></b><span>UID {{ u.uid }}</span></span>
                                <span class="amt">{{ displayCount(u.acoin) }}</span>
                            </div>
                            <div v-if="!gs.sendRank.length" class="empty-row">暂无送出记录</div>
                        </div>
                    </section>
                    <section class="card2">
                        <div class="card2-h"><span class="c2t">贡献榜</span><span class="c2cnt">{{ gs.contribRank.length }} 人</span></div>
                        <div class="alist">
                            <div v-for="(u, i) in gs.contribRank.slice(0, 20)" :key="'c'+u.uid" class="arow">
                                <span class="rk" :class="{ t: i < 3 }">{{ i + 1 }}</span>
                                <span class="aav">{{ (u.userName || '?').slice(0, 1) }}</span>
                                <span class="am"><b><a class="user-link" :href="userUrl(u.uid)" target="_blank">{{ u.userName || '匿名' }}</a></b><span>UID {{ u.uid }}</span></span>
                                <span class="amt">{{ displayCount(u.diamond) }}</span>
                            </div>
                            <div v-if="!gs.contribRank.length" class="empty-row">暂无礼物记录</div>
                        </div>
                    </section>
                </div>

                <section class="card2" v-if="gs.loaded && !gs.loading">
                    <div class="card2-h"><span class="c2t">最近记录</span><span class="c2cnt">{{ gs.recentRecords.length }} 条</span></div>
                    <table class="gift-table" v-if="gs.recentRecords.length">
                        <thead><tr><th>时间</th><th>用户</th><th>礼物</th><th>数量</th><th>方向</th></tr></thead>
                        <tbody>
                            <tr v-for="(r, i) in gs.recentRecords" :key="'r'+i">
                                <td class="mono">{{ r.time }}</td>
                                <td>{{ r.nickname || '—' }}</td>
                                <td>{{ r.giftName || '—' }}</td>
                                <td class="mono">{{ r.count || 1 }}</td>
                                <td>{{ r.direction === 'send' ? '送出' : '收到' }}</td>
                            </tr>
                        </tbody>
                    </table>
                    <div v-else class="empty-row">暂无记录</div>
                </section>
                </template>

                <template v-if="activeTab === 'peach'">
                <div class="st-kpis" v-if="ps.loaded && !gs.loading" style="grid-template-columns: 1fr;">
                    <div class="kpi">
                        <span class="kpi-k">本月收到桃子</span>
                        <span class="kpi-v mono">{{ displayCount(ps.peachTotal) }}</span>
                    </div>
                </div>

                <section class="card2" v-if="ps.loaded && !gs.loading">
                    <div class="card2-h">
                        <span class="c2t">桃榜排行</span>
                        <span class="c2cnt">{{ ps.peachRank.length }} 人</span>
                    </div>
                    <div class="alist" style="max-height: 520px;">
                        <div v-for="(u, i) in ps.peachRank" :key="'mp'+u.uid" class="arow">
                            <span class="rk" :class="{ t: i < 3 }">{{ i + 1 }}</span>
                            <span class="aav">{{ (u.userName || '?').slice(0, 1) }}</span>
                            <span class="am">
                                <b><a class="user-link" :href="userUrl(u.uid)" target="_blank">{{ u.userName || '匿名' }}</a></b>
                                <span>UID {{ u.uid }}</span>
                            </span>
                            <span class="amt">{{ displayCount(u.peach) }}</span>
                        </div>
                        <div v-if="!ps.peachRank.length" class="empty-row">本月暂无桃子记录</div>
                    </div>
                </section>

                <section class="card2" v-if="ps.loaded && !gs.loading">
                    <div class="card2-h">
                        <span class="c2t">本月桃子记录</span>
                        <span class="c2cnt">{{ ps.recentPeachRecords.length }} 条</span>
                    </div>
                    <table class="gift-table" v-if="ps.recentPeachRecords.length">
                        <thead><tr><th>时间</th><th>用户</th><th>桃子</th></tr></thead>
                        <tbody>
                            <tr v-for="(r, i) in ps.recentPeachRecords" :key="'pr'+i">
                                <td class="mono">{{ r.time }}</td>
                                <td><a class="user-link" :href="userUrl(r.userId)" target="_blank">{{ r.nickname || '—' }}</a></td>
                                <td class="mono">{{ r.count }}</td>
                            </tr>
                        </tbody>
                    </table>
                    <div v-else class="empty-row">本月暂无桃子记录</div>
                </section>
                </template>

                <div class="detail-drawer" v-if="showGiftDetail" @click.self="showGiftDetail = false">
                    <div class="backdrop" @click="showGiftDetail = false"></div>
                    <div class="detail-panel">
                        <div class="detail-panel-h">
                            <b>{{ switchToSendGiftTrend ? '送出礼物详情' : '收到礼物详情' }}</b>
                            <button type="button" @click="showGiftDetail = false" aria-label="关闭">×</button>
                        </div>
                        <div class="detail-panel-b">
                            <table class="gift-table" v-if="giftDetailList.length">
                                <thead>
                                    <tr>
                                        <th>用户</th><th>UID</th><th>时间</th><th>礼物</th><th>数量</th>
                                        <th>{{ switchToSendGiftTrend ? 'AC币' : '钻石' }}</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    <tr v-for="(r, i) in giftDetailList" :key="'d'+i">
                                        <td>{{ r.userName || '—' }}</td>
                                        <td class="mono">{{ r.userId }}</td>
                                        <td class="mono">{{ formatRecordTime(r.createTime) }}</td>
                                        <td>{{ r.giftName || '—' }}</td>
                                        <td class="mono">{{ r.giftCount || 1 }}</td>
                                        <td class="mono">{{ switchToSendGiftTrend ? (r.acoin || 0) : (r.azuanAmount || 0) }}</td>
                                    </tr>
                                </tbody>
                            </table>
                            <div v-else class="empty-row">该时段暂无记录</div>
                        </div>
                    </div>
                </div>
            </div>
        `;

        document.querySelector('.ac-member-main').innerHTML = html;

        if (statVue) {
            statVue.$destroy();
            statVue = null;
        }

        var autoStarted = false;
        statVue = new Vue({
            el: '#acfunstat-root',
            data: {
                activeTab: 'gift',
                gs: createDefaultGiftStats(),
                ps: createDefaultPeachStats(),
                loggedIn: isLoggedIn(),
                switchToSendGiftTrend: false,
                giftTrendFormData: { unit: 'day', uid: '' },
                initGiftTrendFinish: false,
                renderGiftTrendChartObj: null,
                renderGiftTrendData: null,
                showGiftDetail: false,
                giftDetailList: [],
            },
            computed: {
                refreshLabel: function () {
                    if (this.gs.loading) return '统计中…';
                    if (this.gs.limited) return '继续完整统计';
                    return this.gs.loaded ? '重新统计' : '开始统计';
                },
                statusText: function () {
                    if (!this.gs.loaded || this.gs.loading) return '';
                    var summary = '已缓存 ' + (this.gs.totalRecords || 0) + ' 条 / ' + (this.gs.pagesRead || 0) + ' 页';
                    return this.gs.limited && this.gs.limitReason ? summary + '，' + this.gs.limitReason : summary;
                },
                trendUserOptions: function () {
                    var range = giftStatsRange(this.gs);
                    var records = this.switchToSendGiftTrend
                        ? filterRecordsInRange(this.gs.sendRecords, range)
                        : filterRecordsInRange(this.gs.receiveRecords, range);
                    return uniqueUsersFromRecords(records);
                },
            },
            watch: {
                giftTrendFormData: {
                    deep: true,
                    handler: function () {
                        var vm = this;
                        if (!vm.gs.loaded || vm.gs.loading) return;
                        vm.$nextTick(function () { vm.renderGiftTrend(); });
                    },
                },
            },
            methods: {
                displayCount: displayCount,
                formatRecordTime: formatRecordTime,
                userUrl: function (uid) {
                    return 'https://www.acfun.cn/u/' + uid;
                },
                disposeTrendChart: function () {
                    if (this.renderGiftTrendChartObj) {
                        this.renderGiftTrendChartObj.dispose();
                        this.renderGiftTrendChartObj = null;
                    }
                    this.initGiftTrendFinish = false;
                },
                setTab: function (tab) {
                    this.activeTab = tab;
                    if (tab === 'peach') {
                        this.showGiftDetail = false;
                        this.disposeTrendChart();
                        this.syncPeachMonth();
                    } else {
                        this.showGiftDetail = false;
                        this.refreshTrendChart();
                    }
                },
                syncPeachMonth: function () {
                    syncPeachMonthState(this.gs, this.ps);
                },
                formatFilterText: function () {
                    var gs = this.gs;
                    if (gs.dateRangeStart && gs.dateRangeEnd) {
                        return '（' + gs.dateRangeStart.slice(0, 10) + ' 至 ' + gs.dateRangeEnd.slice(0, 10) + '）';
                    }
                    return '';
                },
                refreshTrendChart: function () {
                    var vm = this;
                    if (!vm.gs.loaded || vm.gs.loading) return;
                    vm.$nextTick(function () { vm.renderGiftTrend(); });
                },
                renderGiftTrend: function () {
                    if (!this.gs.loaded || this.gs.loading) return;
                    var container = document.getElementById('gift-trend-container');
                    if (!container || typeof echarts === 'undefined') return;

                    var range = giftStatsRange(this.gs);
                    var source = this.switchToSendGiftTrend ? this.gs.sendRecords : this.gs.receiveRecords;
                    var data = filterRecordsInRange(source, range);
                    var uid = String(this.giftTrendFormData.uid || '');
                    if (uid) {
                        data = data.filter(function (r) { return String(r.userId) === uid; });
                    }

                    var unit = this.giftTrendFormData.unit || 'day';
                    var grouped = {};
                    data.forEach(function (record) {
                        var key = recordTimeUnitKey(record, unit);
                        if (!key) return;
                        if (!grouped[key]) grouped[key] = [];
                        grouped[key].push(record);
                    });

                    var lineNameData = Object.keys(grouped).sort();
                    var valueField = this.switchToSendGiftTrend ? 'acoin' : 'azuanAmount';
                    var lineValueData = lineNameData.map(function (key) {
                        return sumRecordField(grouped[key], valueField);
                    });

                    var chart = this.initGiftTrendFinish ? this.renderGiftTrendChartObj : echarts.init(container);
                    chart.setOption({
                        xAxis: { type: 'category', name: '时间', data: lineNameData },
                        yAxis: { type: 'value', name: this.switchToSendGiftTrend ? 'AC币' : '钻石' },
                        series: [{
                            type: 'line',
                            data: lineValueData,
                            name: this.switchToSendGiftTrend ? 'AC币' : '钻石',
                        }],
                        tooltip: {
                            trigger: 'axis',
                            axisPointer: { type: 'line', axis: 'x' },
                            confine: true,
                        },
                        dataZoom: [{ type: 'inside', orient: 'horizontal' }],
                    });

                    this.renderGiftTrendData = grouped;
                    if (!this.initGiftTrendFinish) {
                        var vm = this;
                        chart.on('click', function (params) {
                            chart.dispatchAction({ type: 'hideTip' });
                            vm.giftDetailList = vm.renderGiftTrendData[params.name] || [];
                            vm.showGiftDetail = true;
                        });
                        this.renderGiftTrendChartObj = chart;
                        this.initGiftTrendFinish = true;
                    }
                },
                handleSwitchToSendGiftTrend: function () {
                    this.switchToSendGiftTrend = !this.switchToSendGiftTrend;
                    this.giftTrendFormData.uid = '';
                    this.showGiftDetail = false;
                    this.refreshTrendChart();
                },
                exportGift: function () {
                    if (!this.gs.loaded || typeof ExcelJS === 'undefined') return;
                    var vm = this;
                    var range = giftStatsRange(this.gs);
                    var sendRecords = filterRecordsInRange(this.gs.sendRecords, range);
                    var receiveRecords = filterRecordsInRange(this.gs.receiveRecords, range);
                    var workbook = new ExcelJS.Workbook();

                    function addSheet(title, columns, headerRow, rows) {
                        var sheet = workbook.addWorksheet(title);
                        sheet.columns = columns;
                        var rowIndex = 1;
                        sheet.addRow(headerRow);
                        excelBorderRow(sheet, rowIndex, columns.length, true);
                        rowIndex += 1;
                        rows.forEach(function (row) {
                            sheet.addRow(row);
                            excelBorderRow(sheet, rowIndex, columns.length, false);
                            rowIndex += 1;
                        });
                    }

                    addSheet('送出礼物用户排行榜',
                        [{ key: 'userName', width: 30 }, { key: 'uid', width: 12 }, { key: 'acoin', width: 16 }],
                        { userName: '用户名', uid: '用户uid', acoin: 'AC币' },
                        this.gs.sendRank.map(function (u) {
                            return { userName: u.userName, uid: u.uid, acoin: u.acoin };
                        }));

                    addSheet('桃榜',
                        [{ key: 'userName', width: 30 }, { key: 'uid', width: 12 }, { key: 'receivePeach', width: 16 }],
                        { userName: '用户名', uid: '用户uid', receivePeach: '桃' },
                        this.gs.peachRank.map(function (u) {
                            return { userName: u.userName, uid: u.uid, receivePeach: u.peach };
                        }));

                    addSheet('贡献榜',
                        [{ key: 'userName', width: 30 }, { key: 'uid', width: 12 }, { key: 'diamond', width: 16 }],
                        { userName: '用户名', uid: '用户uid', diamond: '钻石' },
                        this.gs.contribRank.map(function (u) {
                            return { userName: u.userName, uid: u.uid, diamond: u.diamond };
                        }));

                    addSheet('送出礼物详情',
                        [
                            { key: 'userName', width: 24 }, { key: 'uid', width: 12 }, { key: 'createTimeText', width: 22 },
                            { key: 'giftName', width: 18 }, { key: 'giftCount', width: 12 }, { key: 'acoin', width: 12 },
                        ],
                        { userName: '用户名', uid: '用户uid', createTimeText: '送出时间', giftName: '礼物名称', giftCount: '礼物数量', acoin: 'AC币' },
                        sendRecords.map(function (r) {
                            return {
                                userName: r.userName,
                                uid: r.userId,
                                createTimeText: formatRecordTime(r.createTime),
                                giftName: r.giftName,
                                giftCount: r.giftCount,
                                acoin: r.acoin,
                            };
                        }));

                    addSheet('收到礼物详情',
                        [
                            { key: 'userName', width: 24 }, { key: 'uid', width: 12 }, { key: 'createTimeText', width: 22 },
                            { key: 'giftName', width: 18 }, { key: 'giftCount', width: 12 }, { key: 'azuanAmount', width: 12 },
                        ],
                        { userName: '用户名', uid: '用户uid', createTimeText: '收到时间', giftName: '礼物名称', giftCount: '礼物数量', azuanAmount: '钻石' },
                        receiveRecords.map(function (r) {
                            return {
                                userName: r.userName,
                                uid: r.userId,
                                createTimeText: formatRecordTime(r.createTime),
                                giftName: r.giftName,
                                giftCount: r.giftCount,
                                azuanAmount: r.azuanAmount,
                            };
                        }));

                    workbook.xlsx.writeBuffer().then(function (buffer) {
                        var file = new File(
                            [buffer],
                            '【' + formatFileDate() + '】acfun统计' + vm.formatFilterText() + '.xlsx'
                        );
                        if (typeof saveAs === 'function') saveAs(file);
                    }).catch(function (err) {
                        statWarn('Excel 导出失败', err && err.message);
                    });
                },
                exportPeach: function () {
                    if (!this.ps.loaded || typeof ExcelJS === 'undefined') return;
                    var vm = this;
                    var range = giftStatsRange(this.ps);
                    var peachRecords = filterRecordsInRange(this.gs.receiveRecords, range).filter(function (r) {
                        return r.giftName === '桃子';
                    });
                    var workbook = new ExcelJS.Workbook();

                    function addSheet(title, columns, headerRow, rows) {
                        var sheet = workbook.addWorksheet(title);
                        sheet.columns = columns;
                        var rowIndex = 1;
                        sheet.addRow(headerRow);
                        excelBorderRow(sheet, rowIndex, columns.length, true);
                        rowIndex += 1;
                        rows.forEach(function (row) {
                            sheet.addRow(row);
                            excelBorderRow(sheet, rowIndex, columns.length, false);
                            rowIndex += 1;
                        });
                    }

                    addSheet('本月桃榜',
                        [{ key: 'userName', width: 30 }, { key: 'uid', width: 12 }, { key: 'peach', width: 16 }],
                        { userName: '用户名', uid: '用户uid', peach: '桃' },
                        this.ps.peachRank.map(function (u) {
                            return { userName: u.userName, uid: u.uid, peach: u.peach };
                        }));

                    addSheet('本月桃子详情',
                        [
                            { key: 'userName', width: 24 }, { key: 'uid', width: 12 },
                            { key: 'createTimeText', width: 22 }, { key: 'giftCount', width: 12 },
                        ],
                        { userName: '用户名', uid: '用户uid', createTimeText: '收到时间', giftCount: '桃子' },
                        peachRecords.map(function (r) {
                            return {
                                userName: r.userName,
                                uid: r.userId,
                                createTimeText: formatRecordTime(r.createTime),
                                giftCount: r.giftCount,
                            };
                        }));

                    workbook.xlsx.writeBuffer().then(function (buffer) {
                        var file = new File(
                            [buffer],
                            '【' + formatFileDate() + '】acfun本月桃榜（' + vm.ps.rangeLabel + '）.xlsx'
                        );
                        if (typeof saveAs === 'function') saveAs(file);
                    }).catch(function (err) {
                        statWarn('桃榜 Excel 导出失败', err && err.message);
                    });
                },
                setPreset: function (preset) {
                    var range = presetRange(preset);
                    this.gs.preset = preset;
                    this.gs.dateRangeStart = range.start;
                    this.gs.dateRangeEnd = range.end;
                    saveGiftStats(this.gs);
                    this.showGiftDetail = false;
                    this.applyRange();
                },
                applyRange: function () {
                    var range = giftStatsRange(this.gs);
                    if (this.loggedIn && !this.gs.loading && !isGiftStatsRangeCoveredByCache(this.gs, range)) {
                        this.loadStats(false);
                        return;
                    }
                    applyGiftStatsFilter(this.gs);
                    this.syncPeachMonth();
                    this.refreshTrendChart();
                },
                loadStats: function (automatic) {
                    var vm = this;
                    if (!vm.loggedIn) {
                        vm.gs.error = '请先登录 AcFun';
                        return Promise.resolve();
                    }
                    vm.showGiftDetail = false;
                    return loadGiftStats(vm.gs, !!automatic).then(function () {
                        vm.syncPeachMonth();
                        if (vm.activeTab === 'gift') vm.refreshTrendChart();
                    }).catch(function () { /* error shown in gs.error */ });
                },
            },
            mounted: function () {
                statLog('统计页 mounted（Helper 逻辑 + 趋势/导出）');
                var vm = this;
                vm.syncPeachMonth();
                if (!autoStarted && vm.loggedIn && !vm.gs.loading && !vm.gs.loaded) {
                    autoStarted = true;
                    vm.loadStats(true);
                } else if (vm.gs.loaded && vm.activeTab === 'gift') {
                    vm.refreshTrendChart();
                }
            },
            beforeDestroy: function () {
                this.disposeTrendChart();
            },
        });
    }

    function waitForNav() {
        ensureStatNavItem();
        setTimeout(waitForNav, 1000);
    }

    function bootStatNav() {
        watchMemberNavigation();
        waitForNav();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootStatNav);
    } else {
        bootStatNav();
    }
    window.addEventListener('load', ensureStatNavItem);
})();