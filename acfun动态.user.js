// ==UserScript==
// @name         acfun动态
// @namespace    acfun-moment-poster
// @version      0.8.26
// @description  在 AcFun 网页端发布动态（文字 + 图片 + 表情 + 可见范围）。AcFun 官方仅手机 App 可发，本脚本通过 web 登录态换取 app token 调用 moment/add 接口实现网页发布。
// @author       you
// @match        https://www.acfun.cn/member
// @match        https://www.acfun.cn/member/*
// @updateURL    http://127.0.0.1:8787/acfun%E5%8A%A8%E6%80%81.user.js
// @downloadURL  http://127.0.0.1:8787/acfun%E5%8A%A8%E6%80%81.user.js
// @run-at       document-idle
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      id.app.acfun.cn
// @connect      api-ipv6.app.acfun.cn
// @connect      api.app.acfun.cn
// @connect      upload.kuaishouzt.com
// @connect      imgs.aixifan.com
// @connect      acfun.cn
// @connect      www.acfun.cn
// ==/UserScript==

(function () {
    'use strict';

    const SCRIPT_VERSION = (typeof GM_info !== 'undefined' && GM_info.script && GM_info.script.version) || 'dev';
    document.documentElement.dataset.acfunMomentPosterVersion = SCRIPT_VERSION;

    // ====== 可调参数（设备信息，多为常量，服务器一般只记录不强校验）======
    const DEVICE = {
        market: 'appstore',
        app_version: '6.79.1.635',
        appVersion: '6.79.1.635',
        product: 'ACFUN_APP',
        sys_version: '17.0',
        sys_name: 'ios',
        origin: 'ios',
        resolution: '1284x2778',
        acPlatform: 'IPHONE',
        productId: '2000',
        deviceType: '0',
        net: 'WIFI',
        mod: 'iPhone13,4',
        userAgent: 'AcFun/6.79.1 (iPhone; iOS 17.0; Scale/3.00)',
    };
    const TOKEN_URL = 'https://id.app.acfun.cn/rest/web/token/get';
    const API_BASE = 'https://api-ipv6.app.acfun.cn';
    const MOMENT_URL = API_BASE + '/rest/app/moment/add';
    const DELETE_MOMENT_URL = API_BASE + '/rest/app/moment/delete';
    const SQUARE_FEED_URL = API_BASE + '/rest/app/feed/feedSquareV3';
    const IMG_GET_TOKEN_URL = API_BASE + '/rest/app/image/upload/getToken';
    const IMG_GET_URL_URL = API_BASE + '/rest/app/image/upload/getUrlAfterUpload';
    const EMOTION_URL = 'https://www.acfun.cn/rest/pc-direct/emotion/getUserEmotion';
    const KS_FRAGMENT_URL = 'https://upload.kuaishouzt.com/api/upload/fragment';
    const KS_COMPLETE_URL = 'https://upload.kuaishouzt.com/api/upload/complete';
    const MAX_LEN = 233;
    const MAX_IMGS = 9;
    const EMOTION_CACHE_KEY = 'acfun_moment_emotion_packages_v1';
    const EMOTION_CACHE_TTL = 6 * 60 * 60 * 1000;
    const RECENT_EMOTION_KEY = 'acfun_moment_recent_emotions_v1';
    const RECENT_EMOTION_LIMIT = 12;

    // ====== 小工具 ======
    function uuid() {
        return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
            const r = (Math.random() * 16) | 0;
            const v = c === 'x' ? r : (r & 0x3) | 0x8;
            return v.toString(16).toUpperCase();
        });
    }

    function getCookie(name) {
        const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
        return m ? decodeURIComponent(m[1]) : '';
    }

    // 生成 token 头：protobuf{1:1, 2:"<13位毫秒时间戳>"} 的 base64
    function genTokenHeader() {
        const ts = String(Date.now());
        const bytes = [0x08, 0x01, 0x12, ts.length];
        for (let i = 0; i < ts.length; i++) bytes.push(ts.charCodeAt(i));
        let bin = '';
        bytes.forEach((b) => (bin += String.fromCharCode(b)));
        return btoa(bin);
    }

    function getGid() {
        let gid = getCookie('gid') || localStorage.getItem('acfun_moment_gid');
        if (!gid) {
            gid = 'DFP' + Array.from({ length: 61 }, () =>
                '0123456789ABCDEF'[(Math.random() * 16) | 0]).join('');
            localStorage.setItem('acfun_moment_gid', gid);
        }
        return gid;
    }

    function deviceQuery(at) {
        return new URLSearchParams({
            market: DEVICE.market,
            app_version: DEVICE.app_version,
            product: DEVICE.product,
            sys_version: DEVICE.sys_version,
            egid: getGid(),
            origin: DEVICE.origin,
            sys_name: DEVICE.sys_name,
            resolution: DEVICE.resolution,
            access_token: at,
        }).toString();
    }

    function deviceParams(at, extras) {
        const params = new URLSearchParams({
            market: DEVICE.market,
            app_version: DEVICE.app_version,
            product: DEVICE.product,
            sys_version: DEVICE.sys_version,
            egid: getGid(),
            origin: DEVICE.origin,
            sys_name: DEVICE.sys_name,
            resolution: DEVICE.resolution,
            access_token: at,
        });
        Object.keys(extras || {}).forEach((key) => params.set(key, extras[key]));
        return params.toString();
    }

    function gm(opts) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: opts.method || 'GET',
                url: opts.url,
                headers: opts.headers || {},
                data: opts.data,
                binary: !!opts.binary,
                responseType: opts.responseType,
                onload: (r) => resolve(r),
                onerror: () => reject(new Error('网络请求失败')),
                ontimeout: () => reject(new Error('请求超时')),
                timeout: opts.timeout || 30000,
            });
        });
    }

    function parseJSON(r, label) {
        try { return JSON.parse(r.responseText); }
        catch (e) { throw new Error(label + '响应解析失败: ' + String(r.responseText).slice(0, 120)); }
    }

    function escapeHTML(value) {
        return String(value == null ? '' : value).replace(/[&<>"']/g, function (ch) {
            return ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch];
        });
    }

    function escapeAttr(value) {
        return escapeHTML(value).replace(/`/g, '&#96;');
    }

    function normalizeImageUrl(url) {
        if (!url) return '';
        if (url.indexOf('//') === 0) return location.protocol + url;
        return url.replace(/^http:\/\//, 'https://');
    }

    function firstCdnUrl(imageInfo) {
        const fields = ['thumbnailImage', 'smallSharedImage', 'expandedImage', 'originImage'];
        if (!imageInfo) return '';
        for (let i = 0; i < fields.length; i++) {
            const urls = imageInfo[fields[i]] && imageInfo[fields[i]].cdnUrls;
            if (urls && urls.length && urls[0].url) return normalizeImageUrl(urls[0].url);
        }
        return '';
    }

    function firstUrlListItem(list) {
        return list && list.length && list[0].url ? normalizeImageUrl(list[0].url) : '';
    }

    function emotionImageUrl(emotion) {
        return firstCdnUrl(emotion.bigImageInfo)
            || firstCdnUrl(emotion.smallImageInfo)
            || firstUrlListItem(emotion.emotionImageBigUrl)
            || firstUrlListItem(emotion.emotionImageSmallUrl);
    }

    function packageIconUrl(pkg) {
        return firstCdnUrl(pkg.iconImageInfo)
            || firstCdnUrl(pkg.smallImageInfo)
            || firstUrlListItem(pkg.packageImageSmallUrl)
            || firstUrlListItem(pkg.packageImageMiddleUrl)
            || firstUrlListItem(pkg.packageImageBigUrl);
    }

    function formatEmotionPackages(rawPackages) {
        return (rawPackages || []).map((pkg) => {
            const packageName = pkg.name || '表情包';
            const emotions = (pkg.emotions || []).map((emotion) => ({
                id: String(emotion.id || ''),
                name: emotion.name || '',
                imageUrl: emotionImageUrl(emotion),
                packageName: packageName,
            })).filter((emotion) => emotion.id && emotion.imageUrl);
            return {
                id: String(pkg.id || ''),
                name: packageName,
                iconUrl: packageIconUrl(pkg) || (emotions[0] && emotions[0].imageUrl) || '',
                emotions: emotions,
            };
        }).filter((pkg) => pkg.emotions.length > 0);
    }

    function emotionMapFromPackages(packages) {
        const map = {};
        (packages || []).forEach((pkg) => {
            (pkg.emotions || []).forEach((emotion) => {
                if (emotion.id && emotion.imageUrl) map[String(emotion.id)] = emotion;
            });
        });
        return map;
    }

    function readCachedEmotionMap() {
        try {
            const cache = JSON.parse(localStorage.getItem(EMOTION_CACHE_KEY) || 'null');
            if (cache && Array.isArray(cache.packages)) return emotionMapFromPackages(cache.packages);
        } catch (e) { /* 缓存损坏时忽略 */ }
        return {};
    }

    function readRecentEmotionIds() {
        try {
            const ids = JSON.parse(localStorage.getItem(RECENT_EMOTION_KEY) || '[]');
            if (Array.isArray(ids)) return ids.map(String).filter(Boolean).slice(0, RECENT_EMOTION_LIMIT);
        } catch (e) { /* 最近使用损坏时忽略 */ }
        return [];
    }

    function saveRecentEmotionIds(ids) {
        localStorage.setItem(RECENT_EMOTION_KEY, JSON.stringify(ids.slice(0, RECENT_EMOTION_LIMIT)));
    }

    async function loadEmotionPackages(force) {
        if (!force) {
            try {
                const cache = JSON.parse(localStorage.getItem(EMOTION_CACHE_KEY) || 'null');
                if (cache && Array.isArray(cache.packages) && Date.now() - cache.ts < EMOTION_CACHE_TTL) {
                    return cache.packages;
                }
            } catch (e) { /* 缓存损坏时重新拉取 */ }
        }

        const r = await gm({
            method: 'POST',
            url: EMOTION_URL,
            headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
            data: '',
            timeout: 60000,
        });
        const j = parseJSON(r, '表情包');
        if (j.result !== 0) throw new Error('表情包加载失败(' + j.result + ')：' + (j.error_msg || ''));
        const rawPackages = j.emotionPackageList || j.data || [];
        const packages = formatEmotionPackages(rawPackages);
        if (!packages.length) throw new Error('未获取到可用表情包');
        localStorage.setItem(EMOTION_CACHE_KEY, JSON.stringify({ ts: Date.now(), packages: packages }));
        return packages;
    }

    // ====== 鉴权 ======
    async function getAccessToken() {
        const r = await gm({
            method: 'POST', url: TOKEN_URL,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            data: 'sid=acfun.midground.api',
        });
        const j = parseJSON(r, 'token');
        if (j.result !== 0) throw new Error('换取 token 失败(' + j.result + ')：' + (j.error_msg || '') + ' —— 请确认已登录 AcFun');
        const at = j['acfun.midground.api.at'];
        if (!at) throw new Error('响应缺少 access_token');
        return at;
    }

    // ====== 图片上传 ======
    function readImageMeta(file) {
        return new Promise((resolve, reject) => {
            const url = URL.createObjectURL(file);
            const img = new Image();
            img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight, objectURL: url }); };
            img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('图片读取失败')); };
            img.src = url;
        });
    }

    function fileToArrayBuffer(file) {
        return new Promise((resolve, reject) => {
            const fr = new FileReader();
            fr.onload = () => resolve(fr.result);
            fr.onerror = () => reject(new Error('读取文件失败'));
            fr.readAsArrayBuffer(file);
        });
    }

    // 上传单张图片，返回 {url,width,height}
    async function uploadImage(at, file, meta) {
        // 1) 取上传 token
        const gt = parseJSON(await gm({
            method: 'POST', url: IMG_GET_TOKEN_URL + '?' + deviceQuery(at),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, data: '',
        }), 'getToken');
        if (gt.result !== 0) throw new Error('取图片上传 token 失败(' + gt.result + ')');
        let info = gt.info;
        if (typeof info === 'string') info = JSON.parse(info);
        const ut = info.token;
        if (!ut) throw new Error('上传 token 缺失');

        // 2) 上传字节（单分片）
        const buf = await fileToArrayBuffer(file);
        const fr = parseJSON(await gm({
            method: 'POST',
            url: KS_FRAGMENT_URL + '?upload_token=' + encodeURIComponent(ut) + '&fragment_id=0',
            headers: { 'Content-Type': 'application/octet-stream' },
            data: buf, binary: true,
        }), 'fragment');
        if (fr.result !== 1) throw new Error('图片字节上传失败(' + fr.result + ')');

        // 3) 完成上传
        const cr = parseJSON(await gm({
            method: 'POST',
            url: KS_COMPLETE_URL + '?fragment_count=1&upload_token=' + encodeURIComponent(ut),
        }), 'complete');
        if (cr.result !== 1) throw new Error('图片合并失败(' + cr.result + ')');

        // 4) 换取最终 URL
        const ur = parseJSON(await gm({
            method: 'POST', url: IMG_GET_URL_URL + '?' + deviceQuery(at),
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            data: 'token=' + encodeURIComponent(ut),
        }), 'getUrl');
        if (ur.result !== 0 || !ur.url) throw new Error('获取图片 URL 失败(' + ur.result + ')');

        return { url: ur.url, width: meta.width || 0, height: meta.height || 0 };
    }

    function appHeaders(at) {
        const uid = getCookie('auth_key') || getCookie('userId') || '';
        const did = getCookie('_did') || uuid();
        const gid = getGid();
        return {
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json',
            'User-Agent': DEVICE.userAgent,
            'token': genTokenHeader(),
            'random': uuid(),
            'access_token': at,
            'uid': uid,
            'deviceType': DEVICE.deviceType,
            'acPlatform': DEVICE.acPlatform,
            'appVersion': DEVICE.appVersion,
            'productId': DEVICE.productId,
            'market': DEVICE.market,
            'resolution': DEVICE.resolution,
            'net': '--_5',
            'mod': DEVICE.mod,
            'gid': gid,
            'udid': did,
            'isChildPattern': 'false',
        };
    }

    // ====== 发布/删除动态 ======
    async function publishMoment(at, content, imgs, visibleForFans) {
        const params = JSON.stringify({
            content: content,
            imgs: imgs || [],
            shareResourceType: 0,
            visibleForFans: !!visibleForFans,
        });
        const r = await gm({
            method: 'POST', url: MOMENT_URL + '?' + deviceQuery(at),
            headers: appHeaders(at),
            data: 'params=' + encodeURIComponent(params),
        });
        const j = parseJSON(r, '发布');
        if (j.result !== 0) throw new Error('发布失败(' + j.result + ')：' + (j.error_msg || JSON.stringify(j).slice(0, 160)));
        return j;
    }

    async function deleteMoment(at, momentId) {
        if (!momentId) throw new Error('缺少动态 ID');
        const r = await gm({
            method: 'POST',
            url: DELETE_MOMENT_URL + '?' + deviceQuery(at),
            headers: appHeaders(at),
            data: 'momentId=' + encodeURIComponent(momentId),
        });
        const j = parseJSON(r, '删除');
        if (j.result !== 0) throw new Error('删除失败(' + j.result + ')：' + (j.error_msg || JSON.stringify(j).slice(0, 160)));
        return j;
    }

    async function fetchSquareFeed(at, pcursor) {
        const r = await gm({
            method: 'GET',
            url: SQUARE_FEED_URL + '?' + deviceParams(at, {
                count: '20',
                pcursor: pcursor || '',
            }),
            headers: appHeaders(at),
            timeout: 60000,
        });
        const j = parseJSON(r, '广场动态');
        if (j.result !== 0) throw new Error('广场动态加载失败(' + j.result + ')：' + (j.error_msg || JSON.stringify(j).slice(0, 160)));
        return j;
    }

    // ====== UI ======
    GM_addStyle(`
        #amp-inline-host{position:fixed;right:24px;bottom:24px;z-index:9999;box-sizing:border-box;width:auto;max-width:calc(100vw - 32px);
            margin:0;padding:0;font-family:inherit;}
        #amp-float-toggle{display:flex;align-items:center;justify-content:center;width:54px;height:54px;border:none;border-radius:50%;
            background:#fd4c5d;color:#fff;box-shadow:0 8px 24px rgba(253,76,93,.32);cursor:pointer;font-size:24px;line-height:1;}
        #amp-float-toggle:hover{background:#f23b4e;}
        #amp-modal-mask{display:none;position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.28);}
        #amp-modal-mask.amp-open{display:block;}
        #amp-panel{display:none;position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:9999;box-sizing:border-box;
            width:760px;max-width:calc(100vw - 32px);max-height:calc(100vh - 24px);overflow:auto;background:#fff;
            border:1px solid #eee;border-radius:8px;box-shadow:0 10px 32px rgba(0,0,0,.16);padding:14px 16px;font-size:14px;color:#222;font-family:inherit;}
        #amp-inline-host.amp-open #amp-panel{display:block;}
        #amp-square-panel{box-sizing:border-box;width:100%;margin-top:12px;background:#fff;border:1px solid #eee;border-radius:8px;
            box-shadow:0 1px 2px rgba(0,0,0,.03);font-size:14px;color:#222;font-family:inherit;overflow:hidden;}
        #amp-square-panel.amp-member-square{box-shadow:none;}
        #amp-square-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;border-bottom:1px solid #eee;}
        #amp-square-title{font-weight:600;font-size:15px;}
        #amp-square-actions{display:flex;align-items:center;gap:8px;}
        #amp-square-refresh,#amp-square-more{border:1px solid #ddd;border-radius:8px;background:#fff;color:#444;padding:7px 12px;
            cursor:pointer;font-size:13px;}
        #amp-square-refresh:hover,#amp-square-more:hover{border-color:#fd4c5d;color:#fd4c5d;background:#fff5f6;}
        #amp-square-refresh:disabled,#amp-square-more:disabled{color:#aaa;border-color:#eee;background:#fafafa;cursor:not-allowed;}
        #amp-square-list{display:flex;flex-direction:column;}
        #amp-square-state{padding:14px 16px;color:#888;font-size:13px;}
        .amp-square-card{position:relative;padding:14px 16px;border-bottom:1px solid #f1f1f1;background:#fff;}
        .amp-square-card:last-child{border-bottom:none;}
        .amp-square-author{font-weight:600;color:#333;font-size:14px;line-height:1.4;}
        .amp-square-time{margin-left:8px;color:#999;font-size:12px;font-weight:400;}
        .amp-square-text{margin-top:8px;color:#333;font-size:14px;line-height:1.6;white-space:pre-wrap;word-break:break-word;}
        .amp-inline-emotion{width:42px;height:42px;object-fit:contain;vertical-align:middle;margin:0 2px;}
        .amp-square-link{color:inherit;text-decoration:none;}
        .amp-square-link:hover{color:#fd4c5d;}
        .amp-square-imgs{display:grid;grid-template-columns:repeat(auto-fill,minmax(84px,1fr));gap:6px;max-width:360px;margin-top:10px;}
        .amp-square-imgs img{width:100%;aspect-ratio:1;border-radius:6px;object-fit:cover;background:#f6f6f6;display:block;}
        .amp-square-meta{display:flex;gap:8px;margin-top:10px;color:#999;font-size:12px;flex-wrap:wrap;}
        .amp-square-action{display:inline-flex;align-items:center;justify-content:center;min-width:58px;height:28px;padding:0 10px;
            border:1px solid #eee;border-radius:6px;background:#fff;color:#666;text-decoration:none;box-sizing:border-box;}
        .amp-square-action:hover{border-color:#fd4c5d;color:#fd4c5d;background:#fff5f6;text-decoration:none;}
        #amp-text{width:100%;min-height:96px;box-sizing:border-box;border:1px solid #ddd;border-radius:8px;
            padding:10px;font-size:14px;line-height:1.6;outline:none;white-space:pre-wrap;word-break:break-word;overflow:auto;}
        #amp-text:empty:before{content:attr(data-placeholder);color:#aaa;pointer-events:none;}
        #amp-text:focus{border-color:#fd4c5d;}
        .amp-editor-emotion{width:2em;height:2em;object-fit:contain;vertical-align:-.45em;margin:0 2px;}
        #amp-compose-row{display:flex;align-items:center;gap:10px;margin-top:8px;color:#555;font-size:13px;flex-wrap:wrap;}
        #amp-count{color:#999;font-size:12px;min-width:48px;}
        #amp-count.over{color:#fd4c5d;}
        .amp-radio{display:inline-flex;align-items:center;gap:4px;cursor:pointer;user-select:none;}
        .amp-radio input{width:14px;height:14px;margin:0;accent-color:#fd4c5d;}
        #amp-emoji-toggle{width:34px;height:30px;border:1px solid #ddd;border-radius:6px;background:#fff;color:#444;
            cursor:pointer;font-size:16px;line-height:28px;padding:0;}
        #amp-emoji-toggle:hover,#amp-emoji-toggle.active{border-color:#fd4c5d;color:#fd4c5d;background:#fff5f6;}
        #amp-emoji-panel{display:none;margin-top:8px;border:1px solid #eee;border-radius:8px;overflow:visible;background:#fff;}
        #amp-emoji-panel.open{display:block;}
        #amp-emoji-body{display:block;min-height:360px;}
        #amp-emoji-body.package-picker-open{min-height:0;}
        #amp-emoji-head{display:flex;align-items:center;gap:8px;padding:8px;border-bottom:1px solid #eee;background:#fafafa;}
        #amp-emoji-package-button{height:36px;min-width:180px;max-width:260px;border:1px solid #ddd;border-radius:6px;background:#fff;
            cursor:pointer;padding:4px 9px;display:grid;grid-template-columns:28px minmax(0,1fr) auto;align-items:center;gap:7px;text-align:left;}
        #amp-emoji-package-button:hover,#amp-emoji-package-button.active{border-color:#fd4c5d;background:#fff5f6;}
        #amp-emoji-package-button img{width:26px;height:26px;object-fit:contain;display:block;}
        #amp-emoji-package-name{min-width:0;color:#333;font-size:13px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        #amp-emoji-package-arrow{color:#999;font-size:12px;line-height:1;}
        #amp-emoji-package-popover{display:none;margin:8px;padding:10px;border:1px solid #eee;
            border-radius:8px;background:#fff;box-shadow:0 8px 22px rgba(0,0,0,.12);grid-template-columns:repeat(auto-fill,minmax(108px,1fr));gap:8px;}
        #amp-emoji-package-popover.open{display:grid;}
        #amp-emoji-body.package-picker-open #amp-emoji-recent,
        #amp-emoji-body.package-picker-open #amp-emoji-state,
        #amp-emoji-body.package-picker-open #amp-emoji-grid{display:none !important;}
        .amp-emoji-pack-card{height:58px;border:1px solid #eee;border-radius:6px;background:#fff;cursor:pointer;padding:6px;
            display:grid;grid-template-columns:36px minmax(0,1fr);grid-template-rows:1fr auto;align-items:center;column-gap:7px;text-align:left;}
        .amp-emoji-pack-card:hover{border-color:#fd4c5d;background:#fff5f6;}
        .amp-emoji-pack-card.active{border-color:#fd4c5d;background:#fff5f6;}
        .amp-emoji-pack-card img{grid-row:1 / 3;width:34px;height:34px;object-fit:contain;display:block;}
        .amp-emoji-pack-name{min-width:0;color:#333;font-size:12px;line-height:1.25;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        .amp-emoji-pack-count{color:#999;font-size:11px;line-height:1;}
        #amp-emoji-recent{display:none;padding:8px 10px;border-bottom:1px solid #f1f1f1;background:#fff;}
        #amp-emoji-recent.show{display:block;}
        #amp-emoji-recent-title{margin-bottom:6px;color:#777;font-size:12px;line-height:1;}
        #amp-emoji-recent-list{display:grid;grid-template-columns:repeat(auto-fill,50px);justify-content:start;gap:8px;}
        #amp-emoji-grid{display:grid;grid-template-columns:repeat(auto-fill,50px);justify-content:start;align-content:start;gap:8px;max-height:560px;overflow:auto;padding:10px;}
        .amp-emoji-item{width:50px;height:50px;border:1px solid transparent;border-radius:6px;background:#fff;cursor:pointer;padding:5px;
            display:flex;align-items:center;justify-content:center;}
        .amp-emoji-item:hover{border-color:#fd4c5d;background:#fff5f6;}
        .amp-emoji-item img{max-width:100%;max-height:100%;object-fit:contain;display:block;}
        #amp-emoji-preview{display:none;position:fixed;z-index:10000;width:132px;min-height:132px;padding:10px;border:1px solid #eee;
            border-radius:8px;background:#fff;box-shadow:0 10px 28px rgba(0,0,0,.18);pointer-events:none;text-align:center;}
        #amp-emoji-preview.show{display:block;}
        #amp-emoji-preview img{width:112px;height:112px;object-fit:contain;display:block;margin:0 auto;}
        #amp-emoji-preview-name{margin-top:5px;color:#555;font-size:12px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
        #amp-emoji-state{display:none;padding:14px;color:#888;font-size:12px;text-align:center;}
        #amp-emoji-state.show{display:block;}
        #amp-thumbs{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;}
        .amp-thumb{position:relative;width:64px;height:64px;border-radius:6px;overflow:hidden;border:1px solid #eee;}
        .amp-thumb img{width:100%;height:100%;object-fit:cover;display:block;cursor:zoom-in;}
        .amp-thumb .amp-del{position:absolute;right:2px;top:2px;width:18px;height:18px;border:none;border-radius:50%;
            background:rgba(0,0,0,.55);color:#fff;cursor:pointer;font-size:12px;line-height:18px;padding:0;}
        .amp-add-img{width:64px;height:64px;border:1px dashed #ccc;border-radius:6px;background:#fafafa;color:#999;
            cursor:pointer;font-size:24px;line-height:64px;text-align:center;}
        #amp-image-preview-mask{display:none;position:fixed;inset:0;z-index:10001;background:rgba(0,0,0,.68);
            align-items:center;justify-content:center;padding:24px;box-sizing:border-box;cursor:zoom-out;}
        #amp-image-preview-mask.show{display:flex;}
        #amp-image-preview-mask img{max-width:calc(100vw - 48px);max-height:calc(100vh - 48px);object-fit:contain;
            border-radius:8px;background:#fff;box-shadow:0 12px 36px rgba(0,0,0,.32);cursor:default;}
        #amp-bar{display:flex;align-items:center;justify-content:flex-end;margin-top:12px;}
        #amp-actions{display:flex;align-items:center;gap:8px;}
        #amp-send{background:#fd4c5d;color:#fff;border:none;border-radius:8px;padding:8px 18px;cursor:pointer;font-size:14px;}
        #amp-send:disabled{background:#f7a9b1;cursor:not-allowed;}
        .feed-more-menu .amp-feed-delete{color:#d9363e!important;cursor:pointer;}
        .feed-more-menu .amp-feed-delete:hover{background:#fff5f6;}
        .feed-more-menu .amp-feed-delete.disabled{color:#d99!important;cursor:not-allowed;}
        .amp-feed-deleting{opacity:.58;transition:opacity .15s ease;}
        #amp-square-nav-item{cursor:pointer;text-decoration:none;}
        #amp-msg{margin-top:8px;font-size:12px;min-height:16px;}
        #amp-msg.ok{color:#23a35a;} #amp-msg.err{color:#fd4c5d;} #amp-msg.info{color:#888;}
        @media (max-width:640px){
            #amp-inline-host{right:12px;bottom:12px;max-width:calc(100vw - 24px);}
            #amp-panel{width:calc(100vw - 24px);padding:12px;}
            #amp-emoji-package-button{min-width:0;max-width:none;width:100%;}
            #amp-emoji-package-popover{grid-template-columns:repeat(auto-fill,minmax(96px,1fr));}
            #amp-square-head{align-items:flex-start;flex-direction:column;}
            #amp-square-actions{width:100%;justify-content:flex-end;}
            .amp-square-card{padding:12px;}
            #amp-text{min-height:84px;}
            #amp-bar{align-items:flex-end;gap:8px;flex-direction:column;}
            #amp-actions{width:100%;justify-content:flex-end;}
            #amp-send{min-width:88px;}
        }
    `);

    const inlineHost = document.createElement('div');
    inlineHost.id = 'amp-inline-host';
    const modalMask = document.createElement('div');
    modalMask.id = 'amp-modal-mask';
    const floatToggle = document.createElement('button');
    floatToggle.id = 'amp-float-toggle';
    floatToggle.type = 'button';
    floatToggle.title = '发动态';
    floatToggle.setAttribute('aria-label', '发动态');
    floatToggle.textContent = '+';
    const panel = document.createElement('div');
    panel.id = 'amp-panel';
    panel.innerHTML = `
        <div id="amp-text" contenteditable="true" data-placeholder="说点什么…（图片动态文字可留空）"></div>
        <div id="amp-compose-row">
            <span id="amp-count">0/${MAX_LEN}</span>
            <label class="amp-radio"><input name="amp-visible" type="radio" value="public" checked>公开</label>
            <label class="amp-radio"><input name="amp-visible" type="radio" value="fans">仅粉丝</label>
            <button id="amp-emoji-toggle" type="button" title="表情" aria-label="表情">☺</button>
        </div>
        <div id="amp-emoji-panel">
            <div id="amp-emoji-body">
                <div id="amp-emoji-head">
                    <button id="amp-emoji-package-button" type="button" aria-label="选择表情包">
                        <span id="amp-emoji-package-icon"></span>
                        <span id="amp-emoji-package-name">表情包</span>
                        <span id="amp-emoji-package-arrow">▾</span>
                    </button>
                </div>
                <div id="amp-emoji-package-popover"></div>
                <div id="amp-emoji-recent">
                    <div id="amp-emoji-recent-title">最近使用</div>
                    <div id="amp-emoji-recent-list"></div>
                </div>
                <div>
                    <div id="amp-emoji-state"></div>
                    <div id="amp-emoji-grid"></div>
                </div>
            </div>
        </div>
        <div id="amp-thumbs"></div>
        <input id="amp-file" type="file" accept="image/*" multiple style="display:none" />
        <div id="amp-bar">
            <div id="amp-actions">
                <button id="amp-send">发布</button>
            </div>
        </div>
        <div id="amp-msg"></div>
    `;
    inlineHost.appendChild(panel);
    inlineHost.appendChild(floatToggle);

    const squarePanel = document.createElement('div');
    squarePanel.id = 'amp-square-panel';
    squarePanel.innerHTML = `
        <div id="amp-square-head">
            <div id="amp-square-title">广场动态</div>
            <div id="amp-square-actions">
                <button id="amp-square-refresh" type="button">刷新</button>
                <button id="amp-square-more" type="button" disabled>加载更多</button>
            </div>
        </div>
        <div id="amp-square-state">点击刷新查看广场动态</div>
        <div id="amp-square-list"></div>
    `;

    function isMemberPage() {
        return /^\/member(?:\/|$)/.test(location.pathname);
    }

    function mountSquarePanelInline() {
        squarePanel.classList.remove('amp-member-square');
        if (squarePanel.parentNode !== inlineHost) inlineHost.appendChild(squarePanel);
    }

    function insertMemberNavItem(navEle, navItem) {
        const items = Array.from(navEle.querySelectorAll('.ac-member-navigation-item'));
        const followItem = items.find((item) => /关注动态/.test(item.textContent || ''));
        if (followItem) {
            const holder = followItem.closest('.ac-member-navigation-item-wrap,.ac-member-navigation-group,li') || followItem;
            if (holder && holder.parentNode) {
                holder.insertAdjacentElement('afterend', navItem);
                return;
            }
        }
        const historyItem = items.find((item) => /历史记录/.test(item.textContent || ''));
        if (historyItem && historyItem.parentNode) {
            historyItem.insertAdjacentElement('beforebegin', navItem);
            return;
        }
        navEle.appendChild(navItem);
    }

    function activateMemberSquareNav(navEle, navItem) {
        navEle.querySelectorAll('.router-link-exact-active,.router-link-active,.ac-member-navigation-item-active').forEach((item) => {
            if (item === navItem) return;
            item.classList.remove('router-link-exact-active');
            item.classList.remove('router-link-active');
            item.classList.remove('ac-member-navigation-item-active');
        });
        navItem.classList.add('router-link-exact-active');
        navItem.classList.add('ac-member-navigation-item-active');
    }

    function openMemberSquarePage(navItem) {
        const navEle = document.querySelector('.ac-member-navigation');
        const main = document.querySelector('.ac-member-main');
        if (!navEle || !main) return false;

        activateMemberSquareNav(navEle, navItem);
        main.innerHTML = '';
        squarePanel.classList.add('amp-member-square');
        main.appendChild(squarePanel);

        if (!squareList.children.length && !squareLoading) loadSquareFeed(true);
        return true;
    }

    function mountMemberSquareEntry() {
        if (!isMemberPage()) return false;
        const navEle = document.querySelector('.ac-member-navigation');
        if (!navEle) return false;
        if (squarePanel.parentNode === inlineHost) squarePanel.remove();
        const existing = navEle.querySelector('#amp-square-nav-item');
        if (existing) existing.remove();
        return false;
    }

    function scheduleMountMemberSquareEntry() {
        if (!isMemberPage()) return;
        window.clearTimeout(scheduleMountMemberSquareEntry.timer);
        scheduleMountMemberSquareEntry.timer = window.setTimeout(mountMemberSquareEntry, 180);
    }

    function mountSquarePanelForPage() {
        if (isMemberPage()) {
            mountMemberSquareEntry();
            return;
        }
        mountSquarePanelInline();
    }

    function mountFloatingComposer() {
        if (modalMask.parentNode !== document.body) document.body.appendChild(modalMask);
        if (inlineHost.parentNode !== document.body) document.body.appendChild(inlineHost);
        if (emojiPreview.parentNode !== document.body) document.body.appendChild(emojiPreview);
        if (imagePreviewMask.parentNode !== document.body) document.body.appendChild(imagePreviewMask);
    }

    function pinComposerPanelPosition() {
        panel.style.left = '50%';
        panel.style.top = '50%';
        panel.style.transform = 'translate(-50%,-50%)';
        panel.style.display = 'block';
        const rect = panel.getBoundingClientRect();
        panel.style.left = Math.round(rect.left) + 'px';
        panel.style.top = Math.round(rect.top) + 'px';
        panel.style.transform = 'none';
        panel.style.display = '';
    }

    function resetComposerPanelPosition() {
        panel.style.left = '';
        panel.style.top = '';
        panel.style.transform = '';
        panel.style.display = '';
    }

    function setComposerOpen(open) {
        inlineHost.classList.toggle('amp-open', !!open);
        modalMask.classList.toggle('amp-open', !!open);
        if (open) pinComposerPanelPosition();
        else resetComposerPanelPosition();
        floatToggle.title = '发动态';
        floatToggle.setAttribute('aria-label', '发动态');
        if (open) text.focus();
    }

    function momentIdFromUrl(url) {
        if (!url) return '';
        const decoded = String(url).replace(/\\\//g, '/');
        const match = decoded.match(/communityCircle\/moment\/(\d+)/);
        return match ? match[1] : '';
    }

    function momentUrlFromElement(el) {
        if (!el) return '';
        return el.href
            || el.getAttribute('href')
            || el.getAttribute('data-href')
            || el.getAttribute('data-url')
            || el.getAttribute('data-share-url')
            || '';
    }

    function momentIdsInNode(node) {
        const ids = new Set();
        if (!node || !node.querySelectorAll) return ids;
        node.querySelectorAll('a[href*="communityCircle/moment/"],[data-href*="communityCircle/moment/"],[data-url*="communityCircle/moment/"],[data-share-url*="communityCircle/moment/"]').forEach((link) => {
            const id = momentIdFromUrl(momentUrlFromElement(link));
            if (id) ids.add(id);
        });
        return ids;
    }

    function findMomentCard(link, momentId) {
        let node = link.parentElement;
        let fallback = null;
        let depth = 0;
        while (node && node !== document.body && depth < 20) {
            if (node.nodeType === 1 && !node.closest('#amp-inline-host')) {
                const rect = node.getBoundingClientRect();
                if ((rect.width >= 260 || node.clientWidth >= 260) && (rect.height >= 60 || node.clientHeight >= 60)) {
                    const ids = momentIdsInNode(node);
                    if (ids.size === 1 && ids.has(momentId)) {
                        if (node.querySelector('.feed-more')) return node;
                        if (!fallback) fallback = node;
                    }
                }
            }
            node = node.parentElement;
            depth++;
        }
        return fallback || link.parentElement;
    }

    function currentUserId() {
        return getCookie('auth_key') || getCookie('userId') || getCookie('uid') || '';
    }

    function userIdFromUrl(url) {
        if (!url) return '';
        const match = String(url).match(/\/(?:u|upPage)\/(\d+)(?:\.aspx)?(?:[/?#]|$)/);
        return match ? match[1] : '';
    }

    function normalizeId(value) {
        if (value == null) return '';
        const textValue = String(value);
        return /^\d{4,}$/.test(textValue) ? textValue : '';
    }

    function collectIdsFromObject(root, keys, maxDepth) {
        const ids = new Set();
        const seen = new WeakSet();
        const queue = [{ value: root, depth: 0 }];
        const keySet = new Set(keys);
        while (queue.length && ids.size < 20) {
            const current = queue.shift();
            const value = current.value;
            if (!value || typeof value !== 'object') continue;
            if (value === window || value === document || value.nodeType) continue;
            if (seen.has(value)) continue;
            seen.add(value);
            let names = [];
            try { names = Object.keys(value); } catch (e) { continue; }
            names.forEach((name) => {
                let child;
                try { child = value[name]; } catch (e) { return; }
                if (keySet.has(name)) {
                    const id = normalizeId(child);
                    if (id) ids.add(id);
                }
                if (current.depth < maxDepth && child && typeof child === 'object') {
                    queue.push({ value: child, depth: current.depth + 1 });
                }
            });
        }
        return ids;
    }

    function vueObjectsFromNode(node) {
        const objects = [];
        let current = node;
        let depth = 0;
        while (current && current !== document.body && depth < 10) {
            if (current.__vue__) {
                objects.push(current.__vue__);
                if (current.__vue__.$props) objects.push(current.__vue__.$props);
                if (current.__vue__.$data) objects.push(current.__vue__.$data);
            }
            current = current.parentElement;
            depth++;
        }
        return objects;
    }

    function idsFromVueNode(node, keys) {
        const ids = new Set();
        vueObjectsFromNode(node).forEach((obj) => {
            collectIdsFromObject(obj, keys, 5).forEach((id) => ids.add(id));
        });
        return ids;
    }

    function isOwnMomentCard(card) {
        const uid = currentUserId();
        if (!uid || !card || !card.querySelectorAll) return false;
        const attrs = ['userId', 'userid', 'uid', 'authorId', 'authorid', 'authorUid', 'authoruid', 'upId', 'upid'];
        const attrMatched = [card].concat(Array.from(card.querySelectorAll('[data-user-id],[data-userid],[data-uid],[data-author-id],[data-authorid],[data-author-uid],[data-authoruid],[data-up-id],[data-upid]'))).some((node) => {
            return attrs.some((name) => String(node.dataset && node.dataset[name] || '') === uid);
        });
        if (attrMatched) return true;
        const links = Array.from(card.querySelectorAll('a[href*="/u/"],a[href*="/upPage/"]'));
        if (links.some((link) => userIdFromUrl(link.href || link.getAttribute('href')) === uid)) return true;
        const authorKeys = ['authorId', 'authorUid', 'ownerId', 'upId', 'userId', 'uid'];
        return idsFromVueNode(card, authorKeys).has(uid);
    }

    function findNativeFeedMore(card) {
        if (!card || !card.querySelector) return null;
        return card.querySelector('.feed-more');
    }

    function findMomentCardFromFeedMore(more) {
        let node = more && more.parentElement;
        let depth = 0;
        let fallback = null;
        while (node && node !== document.body && depth < 20) {
            if (node.nodeType === 1 && !node.closest('#amp-inline-host')) {
                const ids = momentIdsInNode(node);
                if (ids.size === 1) {
                    return { card: node, momentId: Array.from(ids)[0] };
                }
                if (!fallback) {
                    const vueMomentIds = idsFromVueNode(node, ['momentId', 'resourceId']);
                    if (vueMomentIds.size === 1) {
                        fallback = { card: node, momentId: Array.from(vueMomentIds)[0] };
                    }
                }
            }
            node = node.parentElement;
            depth++;
        }
        return fallback;
    }

    function showGlobalMessage(type, textValue) {
        msg.className = type || '';
        msg.textContent = textValue || '';
    }

    async function deleteFeedMoment(momentId, card, item) {
        if (!momentId) return;
        if (!window.confirm('确认删除动态 ' + momentId + '？')) return;
        const oldText = item.textContent;
        item.classList.add('disabled');
        item.textContent = '删除中';
        card.classList.add('amp-feed-deleting');
        showGlobalMessage('info', '删除动态 ' + momentId + ' 中…');
        try {
            const at = await getAccessToken();
            await deleteMoment(at, momentId);
            card.remove();
            showGlobalMessage('ok', '已删除动态 ' + momentId);
        } catch (e) {
            card.classList.remove('amp-feed-deleting');
            showGlobalMessage('err', e.message);
            window.alert(e.message);
        } finally {
            item.classList.remove('disabled');
            item.textContent = oldText;
        }
    }

    function injectNativeDeleteItem(more, card, momentId) {
        const menu = more.querySelector('.feed-more-menu');
        if (!menu || menu.querySelector('.amp-feed-delete')) return false;
        const item = document.createElement('li');
        item.className = 'amp-feed-delete';
        item.textContent = '删除';
        item.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            if (item.classList.contains('disabled')) return;
            deleteFeedMoment(momentId, card, item);
        });
        menu.appendChild(item);
        more.dataset.ampDeleteState = 'injected';
        return true;
    }

    function scheduleInjectNativeDeleteItem(more, card, momentId) {
        window.setTimeout(() => {
            if (injectNativeDeleteItem(more, card, momentId)) return;
            const observer = new MutationObserver(() => {
                if (injectNativeDeleteItem(more, card, momentId)) observer.disconnect();
            });
            observer.observe(more, { childList: true, subtree: true });
            window.setTimeout(() => observer.disconnect(), 1500);
        }, 0);
    }

    function attachMomentDeleteMenu(card, momentId) {
        if (!card || !momentId) return;
        if (!isOwnMomentCard(card)) return;
        const more = findNativeFeedMore(card);
        if (!more) return;
        if (more.dataset.ampMomentDeleteReady === momentId) return;
        more.dataset.ampMomentDeleteReady = momentId;
        more.dataset.ampDeleteState = 'bound';
        more.addEventListener('click', (ev) => {
            if (ev.target.closest('.amp-feed-delete')) return;
            more.dataset.ampDeleteState = 'scheduled';
            scheduleInjectNativeDeleteItem(more, card, momentId);
        });
    }

    function scanMomentCards(root) {
        const scope = root && root.querySelectorAll ? root : document;
        scope.querySelectorAll('a[href*="communityCircle/moment/"],[data-href*="communityCircle/moment/"],[data-url*="communityCircle/moment/"],[data-share-url*="communityCircle/moment/"]').forEach((link) => {
            if (link.closest('#amp-inline-host')) return;
            if (link.closest('#amp-square-panel')) return;
            const momentId = momentIdFromUrl(momentUrlFromElement(link));
            if (!momentId) return;
            const card = findMomentCard(link, momentId);
            attachMomentDeleteMenu(card, momentId);
        });
    }

    function scheduleScanMomentCards(root) {
        window.clearTimeout(scheduleScanMomentCards.timer);
        scheduleScanMomentCards.timer = window.setTimeout(() => scanMomentCards(root || document), 180);
    }

    const text = panel.querySelector('#amp-text');
    const count = panel.querySelector('#amp-count');
    const send = panel.querySelector('#amp-send');
    const msg = panel.querySelector('#amp-msg');
    const thumbs = panel.querySelector('#amp-thumbs');
    const fileInput = panel.querySelector('#amp-file');
    const emojiToggle = panel.querySelector('#amp-emoji-toggle');
    const emojiPanel = panel.querySelector('#amp-emoji-panel');
    const emojiBody = panel.querySelector('#amp-emoji-body');
    const emojiPackageButton = panel.querySelector('#amp-emoji-package-button');
    const emojiPackageIcon = panel.querySelector('#amp-emoji-package-icon');
    const emojiPackageName = panel.querySelector('#amp-emoji-package-name');
    const emojiPackagePopover = panel.querySelector('#amp-emoji-package-popover');
    const emojiRecent = panel.querySelector('#amp-emoji-recent');
    const emojiRecentList = panel.querySelector('#amp-emoji-recent-list');
    const emojiGrid = panel.querySelector('#amp-emoji-grid');
    const emojiState = panel.querySelector('#amp-emoji-state');
    const emojiPreview = document.createElement('div');
    emojiPreview.id = 'amp-emoji-preview';
    emojiPreview.innerHTML = '<img alt=""><div id="amp-emoji-preview-name"></div>';
    const emojiPreviewImg = emojiPreview.querySelector('img');
    const emojiPreviewName = emojiPreview.querySelector('#amp-emoji-preview-name');
    const imagePreviewMask = document.createElement('div');
    imagePreviewMask.id = 'amp-image-preview-mask';
    imagePreviewMask.innerHTML = '<img alt="图片预览">';
    const imagePreviewImg = imagePreviewMask.querySelector('img');
    const visibleInputs = Array.from(panel.querySelectorAll('input[name="amp-visible"]'));
    const squareRefresh = squarePanel.querySelector('#amp-square-refresh');
    const squareMore = squarePanel.querySelector('#amp-square-more');
    const squareState = squarePanel.querySelector('#amp-square-state');
    const squareList = squarePanel.querySelector('#amp-square-list');

    mountFloatingComposer();
    mountSquarePanelForPage();

    // 已选图片：{file, objectURL, width, height}
    let picked = [];
    let emotionPackages = null;
    let emotionLoading = null;
    let emotionMap = readCachedEmotionMap();
    let activeEmotionPackageIndex = 0;
    let recentEmotionIds = readRecentEmotionIds();
    let missingEmotionReloadTimer = null;
    let missingEmotionReloading = false;
    const missingEmotionReloadedIds = new Set();
    let squarePcursor = '';
    let squareLoading = false;

    function setSquareState(textValue) {
        squareState.textContent = textValue || '';
        squareState.style.display = textValue ? 'block' : 'none';
    }

    function imageUrlFromCdnInfo(info) {
        if (!info) return '';
        if (info.cdnUrls && info.cdnUrls.length && info.cdnUrls[0].url) {
            return normalizeImageUrl(info.cdnUrls[0].url);
        }
        return firstCdnUrl(info) || '';
    }

    function imageUrlFromMomentImage(image) {
        if (!image) return '';
        return normalizeImageUrl(
            image.url
            || image.expandedUrl
            || image.originUrl
            || image.thumbnailImageCdnUrl
            || imageUrlFromCdnInfo(image.thumbnailImage)
            || imageUrlFromCdnInfo(image.smallSharedImage)
            || imageUrlFromCdnInfo(image.expandedImage)
            || imageUrlFromCdnInfo(image.originImage)
        );
    }

    function normalizeSquareFeedItem(item) {
        const moment = item.moment || {};
        const user = item.user || item.userInfo || moment.user || {};
        const momentId = String(moment.momentId || item.resourceId || '');
        const shareUrl = item.shareUrl || moment.shareUrl || (momentId ? 'https://m.acfun.cn/communityCircle/moment/' + momentId : '');
        const imgs = []
            .concat(moment.imgs || [])
            .concat(moment.imgInfos || [])
            .map(imageUrlFromMomentImage)
            .filter(Boolean);
        return {
            momentId: momentId,
            shareUrl: shareUrl,
            userName: user.name || user.userName || 'AcFun 用户',
            text: moment.text || item.discoveryResourceFeedShowContent || item.content || '',
            createTime: moment.createTime || item.createTimeGroup || item.createTime || '',
            likeCount: item.likeCount || moment.likeCount || 0,
            commentCount: item.commentCount || moment.commentCount || 0,
            shareCount: item.shareCount || moment.shareCount || 0,
            imgs: imgs.slice(0, 9),
        };
    }

    function renderSquareCard(feed) {
        const data = normalizeSquareFeedItem(feed);
        if (!data.momentId) return null;
        const card = document.createElement('div');
        card.className = 'amp-square-card';
        const interactionUrl = data.shareUrl || ('https://m.acfun.cn/communityCircle/moment/' + data.momentId);
        card.innerHTML = `
            <a class="amp-square-link" href="${escapeHTML(data.shareUrl)}" target="_blank" rel="noopener">
                <div class="amp-square-author">${escapeHTML(data.userName)}<span class="amp-square-time">${escapeHTML(data.createTime)}</span></div>
                <div class="amp-square-text">${renderRichText(data.text || '发布了')}</div>
            </a>
            ${data.imgs.length ? '<div class="amp-square-imgs">' + data.imgs.map((url) => '<img src="' + escapeHTML(url) + '" loading="lazy" alt="">').join('') + '</div>' : ''}
            <div class="amp-square-meta">
                <a class="amp-square-action" href="${escapeHTML(interactionUrl)}" target="_blank" rel="noopener">赞 ${escapeHTML(data.likeCount)}</a>
                <a class="amp-square-action" href="${escapeHTML(interactionUrl)}" target="_blank" rel="noopener">评论 ${escapeHTML(data.commentCount)}</a>
                <a class="amp-square-action" href="${escapeHTML(interactionUrl)}" target="_blank" rel="noopener">转发 ${escapeHTML(data.shareCount)}</a>
            </div>
        `;
        const textEl = card.querySelector('.amp-square-text');
        if (textEl) textEl.dataset.rawText = data.text || '发布了';
        return card;
    }

    async function loadSquareFeed(reset) {
        if (squareLoading) return;
        squareLoading = true;
        squareRefresh.disabled = true;
        squareMore.disabled = true;
        setSquareState(reset ? '正在刷新广场动态…' : '正在加载更多…');
        try {
            const at = await getAccessToken();
            const data = await fetchSquareFeed(at, reset ? '' : squarePcursor);
            const feeds = data.feedList || [];
            if (reset) squareList.innerHTML = '';
            feeds.forEach((feed) => {
                const card = renderSquareCard(feed);
                if (card) squareList.appendChild(card);
            });
            squarePcursor = data.pcursor || '';
            setSquareState(feeds.length ? '' : (reset ? '广场暂时没有动态' : '没有更多了'));
            squareMore.disabled = !squarePcursor || squarePcursor === 'no_more';
        } catch (e) {
            setSquareState(e.message);
            showGlobalMessage('err', e.message);
        } finally {
            squareLoading = false;
            squareRefresh.disabled = false;
        }
    }

    function renderThumbs() {
        thumbs.innerHTML = '';
        picked.forEach((p, idx) => {
            const d = document.createElement('div');
            d.className = 'amp-thumb';
            d.innerHTML = `<img src="${p.objectURL}" data-i="${idx}" title="预览图片"><button class="amp-del" data-i="${idx}" title="移除">×</button>`;
            thumbs.appendChild(d);
        });
        if (picked.length < MAX_IMGS) {
            const add = document.createElement('div');
            add.className = 'amp-add-img';
            add.textContent = '＋';
            add.title = '添加图片';
            add.addEventListener('click', () => fileInput.click());
            thumbs.appendChild(add);
        }
        thumbs.querySelectorAll('.amp-del').forEach((b) => {
            b.addEventListener('click', (ev) => {
                ev.stopPropagation();
                const i = Number(b.dataset.i);
                if (!picked[i]) return;
                URL.revokeObjectURL(picked[i].objectURL);
                picked.splice(i, 1);
                renderThumbs();
            });
        });
    }

    function showImagePreview(index) {
        const item = picked[index];
        if (!item) return;
        imagePreviewImg.src = item.objectURL;
        imagePreviewMask.classList.add('show');
    }

    function hideImagePreview() {
        imagePreviewMask.classList.remove('show');
        imagePreviewImg.removeAttribute('src');
    }

    function currentVisibleForFans() {
        const pickedVisible = visibleInputs.find((input) => input.checked);
        return pickedVisible && pickedVisible.value === 'fans';
    }

    function serializeEditorContent() {
        let out = '';
        function walk(node) {
            if (!node) return;
            if (node.nodeType === Node.TEXT_NODE) {
                out += node.nodeValue || '';
                return;
            }
            if (node.nodeType !== Node.ELEMENT_NODE) return;
            if (node.classList && node.classList.contains('amp-editor-emotion')) {
                const id = node.dataset.emotionId;
                if (id) out += '[emot=acfun,' + id + '/]';
                return;
            }
            if (node.tagName === 'BR') {
                out += '\n';
                return;
            }
            if (node !== text && (node.tagName === 'DIV' || node.tagName === 'P')) {
                if (out && !out.endsWith('\n')) out += '\n';
            }
            Array.from(node.childNodes).forEach(walk);
            if (node !== text && (node.tagName === 'DIV' || node.tagName === 'P')) {
                if (!out.endsWith('\n')) out += '\n';
            }
        }
        Array.from(text.childNodes).forEach(walk);
        return out.replace(/\n{3,}/g, '\n\n').trim();
    }

    function updateCount() {
        const n = [...serializeEditorContent()].length;
        count.textContent = n + '/' + MAX_LEN;
        count.classList.toggle('over', n > MAX_LEN);
    }

    function insertNodeAtEditorCursor(node) {
        text.focus();
        const sel = window.getSelection();
        let range = sel && sel.rangeCount ? sel.getRangeAt(0) : null;
        if (!range || !text.contains(range.commonAncestorContainer)) {
            range = document.createRange();
            range.selectNodeContents(text);
            range.collapse(false);
        }
        range.deleteContents();
        range.insertNode(node);
        range.setStartAfter(node);
        range.setEndAfter(node);
        sel.removeAllRanges();
        sel.addRange(range);
        updateCount();
    }

    function insertEmojiImageAtCursor(emotion) {
        const img = document.createElement('img');
        img.className = 'amp-editor-emotion';
        img.src = emotion.imageUrl;
        img.alt = emotion.name || '';
        img.title = emotion.name || emotion.id;
        img.dataset.emotionId = emotion.id;
        img.contentEditable = 'false';
        insertNodeAtEditorCursor(img);
    }

    function renderRichText(value) {
        const raw = String(value == null ? '' : value);
        const re = /\[emot=acfun,(\d+)\/\]/g;
        let html = '';
        let last = 0;
        let match;
        while ((match = re.exec(raw))) {
            html += escapeHTML(raw.slice(last, match.index));
            const emotion = emotionMap[match[1]];
            if (emotion && emotion.imageUrl) {
                html += '<img class="amp-inline-emotion" src="' + escapeAttr(emotion.imageUrl) + '" alt="' + escapeAttr(emotion.name || '') + '" title="' + escapeAttr(emotion.name || match[1]) + '">';
            } else {
                scheduleMissingEmotionReload(match[1]);
                html += escapeHTML(match[0]);
            }
            last = re.lastIndex;
        }
        html += escapeHTML(raw.slice(last));
        return html;
    }

    function refreshRenderedEmotionText() {
        squareList.querySelectorAll('.amp-square-text').forEach((el) => {
            if (el.dataset.rawText != null) el.innerHTML = renderRichText(el.dataset.rawText);
        });
    }

    function scheduleMissingEmotionReload(id) {
        if (!id || missingEmotionReloadedIds.has(String(id))) return;
        missingEmotionReloadedIds.add(String(id));
        window.clearTimeout(missingEmotionReloadTimer);
        missingEmotionReloadTimer = window.setTimeout(reloadMissingEmotions, 120);
    }

    async function reloadMissingEmotions() {
        if (missingEmotionReloading) return;
        missingEmotionReloading = true;
        try {
            if (emotionLoading) {
                try { await emotionLoading; } catch (e) { /* 后面强制刷新兜底 */ }
            }
            emotionLoading = loadEmotionPackages(true)
                .then((packages) => {
                    emotionPackages = packages;
                    emotionMap = emotionMapFromPackages(packages);
                    refreshRenderedEmotionText();
                    return packages;
                })
                .finally(() => { emotionLoading = null; });
            await emotionLoading;
        } catch (e) {
            /* 表情强刷失败时保留原文本，不阻断广场和发布器 */
        } finally {
            missingEmotionReloading = false;
        }
    }

    function setEmojiState(textValue) {
        emojiState.textContent = textValue || '';
        emojiState.classList.toggle('show', !!textValue);
        emojiGrid.style.display = textValue ? 'none' : 'grid';
    }

    function packageIconHtml(pkg) {
        if (pkg && pkg.iconUrl) return '<img src="' + escapeHTML(pkg.iconUrl) + '" alt="">';
        return '<span>' + escapeHTML(((pkg && pkg.name) || '表').slice(0, 1)) + '</span>';
    }

    function closeEmojiPackagePopover() {
        emojiPackagePopover.classList.remove('open');
        emojiPackageButton.classList.remove('active');
        emojiBody.classList.remove('package-picker-open');
    }

    function setEmojiPackagePopoverOpen(open) {
        emojiPackagePopover.classList.toggle('open', !!open);
        emojiPackageButton.classList.toggle('active', !!open);
        emojiBody.classList.toggle('package-picker-open', !!open);
        if (open) hideEmojiPreview();
    }

    function renderEmojiPackagePicker() {
        const activePackage = emotionPackages && emotionPackages[activeEmotionPackageIndex];
        emojiPackageIcon.innerHTML = packageIconHtml(activePackage);
        emojiPackageName.textContent = activePackage ? activePackage.name : '表情包';
        emojiPackagePopover.innerHTML = '';
        (emotionPackages || []).forEach((pkg, idx) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'amp-emoji-pack-card' + (idx === activeEmotionPackageIndex ? ' active' : '');
            b.dataset.index = String(idx);
            b.title = pkg.name;
            b.innerHTML = packageIconHtml(pkg)
                + '<span class="amp-emoji-pack-name">' + escapeHTML(pkg.name) + '</span>'
                + '<span class="amp-emoji-pack-count">' + escapeHTML(pkg.emotions.length) + ' 个</span>';
            emojiPackagePopover.appendChild(b);
        });
    }

    function renderRecentEmotions() {
        const recent = recentEmotionIds.map((id) => emotionMap[id]).filter((emotion) => emotion && emotion.imageUrl);
        emojiRecent.classList.toggle('show', recent.length > 0);
        emojiRecentList.innerHTML = '';
        recent.forEach((emotion) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'amp-emoji-item';
            b.dataset.id = emotion.id;
            b.dataset.preview = emotion.imageUrl;
            b.dataset.name = emotion.name || emotion.id;
            b.title = (emotion.name || emotion.id) + ' / ' + emotion.packageName;
            b.innerHTML = '<img src="' + escapeHTML(emotion.imageUrl) + '" alt="' + escapeHTML(emotion.name || emotion.id) + '" loading="lazy">';
            emojiRecentList.appendChild(b);
        });
    }

    function rememberRecentEmotion(id) {
        id = String(id || '');
        if (!id) return;
        recentEmotionIds = [id].concat(recentEmotionIds.filter((item) => item !== id)).slice(0, RECENT_EMOTION_LIMIT);
        saveRecentEmotionIds(recentEmotionIds);
        renderRecentEmotions();
    }

    function hideEmojiPreview() {
        emojiPreview.classList.remove('show');
    }

    function showEmojiPreview(item) {
        const url = item.dataset.preview;
        if (!url) return;
        emojiPreviewImg.src = url;
        emojiPreviewName.textContent = item.dataset.name || '';
        const rect = item.getBoundingClientRect();
        const previewWidth = 154;
        const previewHeight = 160;
        const left = Math.min(
            Math.max(8, rect.left + rect.width / 2 - previewWidth / 2),
            window.innerWidth - previewWidth - 8
        );
        const top = rect.top >= previewHeight + 12
            ? rect.top - previewHeight - 8
            : Math.min(window.innerHeight - previewHeight - 8, rect.bottom + 8);
        emojiPreview.style.left = left + 'px';
        emojiPreview.style.top = Math.max(8, top) + 'px';
        emojiPreview.classList.add('show');
    }

    function renderEmojiGrid() {
        const pkg = emotionPackages && emotionPackages[activeEmotionPackageIndex];
        emojiGrid.innerHTML = '';
        if (!pkg) {
            setEmojiState('暂无表情');
            return;
        }
        setEmojiState('');
        pkg.emotions.forEach((emotion) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'amp-emoji-item';
            b.dataset.id = emotion.id;
            b.dataset.preview = emotion.imageUrl;
            b.dataset.name = emotion.name || emotion.id;
            b.title = (emotion.name || emotion.id) + ' / ' + emotion.packageName;
            b.innerHTML = '<img src="' + escapeHTML(emotion.imageUrl) + '" alt="' + escapeHTML(emotion.name || emotion.id) + '" loading="lazy">';
            emojiGrid.appendChild(b);
        });
    }

    function renderEmojiPanel() {
        renderEmojiPackagePicker();
        renderRecentEmotions();
        renderEmojiGrid();
    }

    async function ensureEmojiPanel() {
        if (emotionPackages) {
            renderEmojiPanel();
            return;
        }
        if (!emotionLoading) {
            setEmojiState('表情加载中…');
            emotionLoading = loadEmotionPackages(false)
                .then((packages) => {
                    emotionPackages = packages;
                    emotionMap = emotionMapFromPackages(packages);
                    activeEmotionPackageIndex = 0;
                    refreshRenderedEmotionText();
                    return packages;
                })
                .finally(() => { emotionLoading = null; });
        }
        await emotionLoading;
        renderEmojiPanel();
    }

    function ensureEmotionMapForDisplay() {
        if (Object.keys(emotionMap).length || emotionLoading) return;
        emotionLoading = loadEmotionPackages(false)
            .then((packages) => {
                emotionPackages = packages;
                emotionMap = emotionMapFromPackages(packages);
                refreshRenderedEmotionText();
                return packages;
            })
            .finally(() => { emotionLoading = null; });
    }

    fileInput.addEventListener('change', async () => {
        const files = Array.from(fileInput.files || []);
        fileInput.value = '';
        for (const f of files) {
            if (picked.length >= MAX_IMGS) break;
            try {
                const meta = await readImageMeta(f);
                picked.push({ file: f, objectURL: meta.objectURL, width: meta.width, height: meta.height });
            } catch (e) { /* 跳过坏图 */ }
        }
        renderThumbs();
    });

    renderThumbs();
    updateCount();
    setSquareState('点击刷新查看广场动态');

    function closeComposerModal() {
        setComposerOpen(false);
        emojiPanel.classList.remove('open');
        emojiToggle.classList.remove('active');
        closeEmojiPackagePopover();
    }

    floatToggle.addEventListener('click', () => setComposerOpen(true));
    modalMask.addEventListener('click', closeComposerModal);
    text.addEventListener('input', updateCount);
    text.addEventListener('paste', (ev) => {
        ev.preventDefault();
        const plain = (ev.clipboardData || window.clipboardData).getData('text/plain') || '';
        insertNodeAtEditorCursor(document.createTextNode(plain));
    });
    squareRefresh.addEventListener('click', () => loadSquareFeed(true));
    squareMore.addEventListener('click', () => loadSquareFeed(false));
    thumbs.addEventListener('click', (ev) => {
        const img = ev.target.closest('.amp-thumb img');
        if (!img) return;
        showImagePreview(Number(img.dataset.i));
    });
    imagePreviewMask.addEventListener('click', (ev) => {
        if (ev.target === imagePreviewMask) hideImagePreview();
    });

    emojiToggle.addEventListener('click', async () => {
        const willOpen = !emojiPanel.classList.contains('open');
        emojiPanel.classList.toggle('open', willOpen);
        emojiToggle.classList.toggle('active', willOpen);
        if (!willOpen) return;
        try {
            await ensureEmojiPanel();
        } catch (e) {
            setEmojiState(e.message || '表情加载失败');
        }
    });

    ensureEmotionMapForDisplay();

    emojiPackageButton.addEventListener('click', (ev) => {
        ev.stopPropagation();
        const willOpen = !emojiPackagePopover.classList.contains('open');
        setEmojiPackagePopoverOpen(willOpen);
    });

    emojiPackagePopover.addEventListener('click', (ev) => {
        const card = ev.target.closest('.amp-emoji-pack-card');
        if (!card) return;
        activeEmotionPackageIndex = Number(card.dataset.index) || 0;
        closeEmojiPackagePopover();
        renderEmojiPanel();
    });

    function handleEmojiItemClick(ev) {
        const item = ev.target.closest('.amp-emoji-item');
        if (!item || !item.dataset.id) return;
        const emotion = emotionMap[item.dataset.id];
        if (emotion) {
            insertEmojiImageAtCursor(emotion);
            rememberRecentEmotion(emotion.id);
        }
    }

    function handleEmojiItemMouseOver(ev) {
        const item = ev.target.closest('.amp-emoji-item');
        if (item) showEmojiPreview(item);
    }

    function handleEmojiItemMouseOut(ev) {
        const from = ev.target.closest('.amp-emoji-item');
        const to = ev.relatedTarget && ev.relatedTarget.closest && ev.relatedTarget.closest('.amp-emoji-item');
        if (from && from !== to) hideEmojiPreview();
    }

    emojiGrid.addEventListener('click', handleEmojiItemClick);
    emojiGrid.addEventListener('mouseover', handleEmojiItemMouseOver);
    emojiGrid.addEventListener('mouseout', handleEmojiItemMouseOut);
    emojiRecentList.addEventListener('click', handleEmojiItemClick);
    emojiRecentList.addEventListener('mouseover', handleEmojiItemMouseOver);
    emojiRecentList.addEventListener('mouseout', handleEmojiItemMouseOut);

    document.addEventListener('click', (ev) => {
        if (!ev.target.closest('#amp-emoji-head')) closeEmojiPackagePopover();
        const more = ev.target.closest('.feed-more');
        if (more && !more.closest('#amp-inline-host') && !more.closest('#amp-square-panel')) {
            const found = findMomentCardFromFeedMore(more);
            if (!found) {
                more.dataset.ampDeleteState = 'no-card';
                return;
            }
            if (!isOwnMomentCard(found.card)) {
                more.dataset.ampDeleteState = 'not-own';
                return;
            }
            more.dataset.ampDeleteState = 'scheduled';
            scheduleInjectNativeDeleteItem(more, found.card, found.momentId);
        }
    }, true);
    document.addEventListener('keydown', (ev) => {
        if (ev.key === 'Escape' && imagePreviewMask.classList.contains('show')) {
            hideImagePreview();
            return;
        }
        if (ev.key === 'Escape' && inlineHost.classList.contains('amp-open')) {
            closeComposerModal();
        }
    });

    scanMomentCards(document);
    const feedObserver = new MutationObserver((mutations) => {
        for (let i = 0; i < mutations.length; i++) {
            if (mutations[i].addedNodes && mutations[i].addedNodes.length) {
                scheduleScanMomentCards(document);
                scheduleMountMemberSquareEntry();
                return;
            }
        }
    });
    feedObserver.observe(document.body, { childList: true, subtree: true });
    if (!isMemberPage()) window.setTimeout(() => loadSquareFeed(true), 300);

    send.addEventListener('click', async () => {
        const content = serializeEditorContent();
        msg.className = '';
        msg.textContent = '';
        if (!content && picked.length === 0) {
            msg.className = 'err'; msg.textContent = '请输入文字或选择图片';
            return;
        }
        if ([...content].length > MAX_LEN) {
            msg.className = 'err'; msg.textContent = '文字长度不能超过 ' + MAX_LEN + ' 字';
            return;
        }
        send.disabled = true;
        send.textContent = '发布中…';
        try {
            const at = await getAccessToken();
            const imgs = [];
            for (let i = 0; i < picked.length; i++) {
                msg.className = 'info';
                msg.textContent = `上传图片 ${i + 1}/${picked.length}…`;
                imgs.push(await uploadImage(at, picked[i].file, picked[i]));
            }
            msg.className = 'info';
            msg.textContent = '发布中…';
            const published = await publishMoment(at, content, imgs, currentVisibleForFans());
            msg.className = 'ok';
            msg.textContent = published && published.moment && published.moment.momentId
                ? '发布成功！动态 ID：' + published.moment.momentId
                : '发布成功！';
            scheduleScanMomentCards(document);
            text.innerHTML = '';
            closeComposerModal();
            const publicVisible = visibleInputs.find((input) => input.value === 'public');
            if (publicVisible) publicVisible.checked = true;
            updateCount();
            picked.forEach((p) => URL.revokeObjectURL(p.objectURL));
            picked = [];
            renderThumbs();
        } catch (e) {
            msg.className = 'err';
            msg.textContent = e.message;
        } finally {
            send.disabled = false;
            send.textContent = '发布';
        }
    });
})();
