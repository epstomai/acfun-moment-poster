// ==UserScript==
// @name         acfun动态
// @namespace    acfun-moment-poster
// @version      0.8.39
// @description  在 AcFun 网页端发布动态（文字 + 图片 + 表情 + 可见范围）。AcFun 官方仅手机 App 可发，本脚本通过 web 登录态换取 app token 调用 moment/add 接口实现网页发布。
// @author       you
// @license      MIT
// @match        https://www.acfun.cn/member
// @match        https://www.acfun.cn/member/*
// @match        https://www.acfun.cn/moment/am*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        unsafeWindow
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

    // ====== UI ======
    GM_addStyle(`
        #amp-inline-host{position:fixed;right:24px;bottom:24px;z-index:9999;box-sizing:border-box;width:auto;max-width:calc(100vw - 32px);
            margin:0;padding:0;font-family:inherit;}
        #amp-float-toggle{display:flex;align-items:center;justify-content:center;width:54px;height:54px;border:none;border-radius:50%;
            background:#fd4c5d;color:#fff;box-shadow:0 8px 24px rgba(253,76,93,.32);cursor:pointer;font-size:24px;line-height:1;}
        #amp-float-toggle:hover{background:#f23b4e;}
        .amp-detail-delete{display:inline-flex;align-items:center;justify-content:center;min-width:28px;height:49px;margin:0 0 0 34px;
            border:none;background:transparent;color:#999;cursor:pointer;font:inherit;font-size:12px;line-height:1;text-decoration:none;vertical-align:middle;padding:0;}
        .amp-detail-delete:hover{color:#d9363e;text-decoration:none;}
        .amp-detail-delete:disabled{color:#bbb;cursor:not-allowed;}
        #amp-modal-mask{display:none;position:fixed;inset:0;z-index:9998;background:rgba(0,0,0,.28);}
        #amp-modal-mask.amp-open{display:block;}
        #amp-panel{display:none;position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:9999;box-sizing:border-box;
            width:760px;max-width:calc(100vw - 32px);max-height:calc(100vh - 24px);overflow:auto;background:#fff;
            border:1px solid #eee;border-radius:8px;box-shadow:0 10px 32px rgba(0,0,0,.16);padding:14px 16px;font-size:14px;color:#222;font-family:inherit;}
        #amp-inline-host.amp-open #amp-panel{display:block;}
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
        #amp-msg{margin-top:8px;font-size:12px;min-height:16px;}
        #amp-msg.ok{color:#23a35a;} #amp-msg.err{color:#fd4c5d;} #amp-msg.info{color:#888;}
        @media (max-width:640px){
            #amp-inline-host{right:12px;bottom:12px;max-width:calc(100vw - 24px);}
            #amp-panel{width:calc(100vw - 24px);padding:12px;}
            #amp-emoji-package-button{min-width:0;max-width:none;width:100%;}
            #amp-emoji-package-popover{grid-template-columns:repeat(auto-fill,minmax(96px,1fr));}
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

    function detailMomentIdFromLocation() {
        const match = location.pathname.match(/^\/moment\/am(\d+)(?:\/|$)/);
        return match ? match[1] : '';
    }

    function isMomentDetailPage() {
        return !!detailMomentIdFromLocation();
    }

    function mountFloatingComposer() {
        if (modalMask.parentNode !== document.body) document.body.appendChild(modalMask);
        if (!isMomentDetailPage() && inlineHost.parentNode !== document.body) document.body.appendChild(inlineHost);
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

    function showGlobalMessage(type, textValue) {
        msg.className = type || '';
        msg.textContent = textValue || '';
    }

    function showStatusMessage(type, textValue) {
        if (inlineHost.parentNode) {
            showGlobalMessage(type, textValue);
        }
    }

    async function deleteFeedMoment(momentId, card, item) {
        if (!momentId) return;
        if (!window.confirm('确认删除动态 ' + momentId + '？')) return;
        const oldText = item && item.textContent;
        let succeeded = false;
        if (item) {
            item.classList.add('disabled');
            item.disabled = true;
            item.textContent = '删除中';
        }
        if (card && card.classList) card.classList.add('amp-feed-deleting');
        showStatusMessage('info', '删除动态 ' + momentId + ' 中…');
        try {
            const at = await getAccessToken();
            await deleteMoment(at, momentId);
            if (card && card.remove) card.remove();
            succeeded = true;
            showStatusMessage('ok', '已删除动态 ' + momentId);
        } catch (e) {
            if (card && card.classList) card.classList.remove('amp-feed-deleting');
            showStatusMessage('err', e.message);
            window.alert(e.message);
        } finally {
            if (item) {
                item.classList.remove('disabled');
                if (succeeded) {
                    item.disabled = true;
                    item.textContent = '已删除';
                } else {
                    item.disabled = false;
                    item.textContent = oldText;
                }
            }
        }
    }

    function isVisibleElement(el) {
        if (!el || el.nodeType !== 1 || el.closest('#amp-inline-host')) return false;
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
    }

    function isDetailActionRow(el) {
        if (!isVisibleElement(el)) return false;
        const rect = el.getBoundingClientRect();
        if (rect.height < 35 || rect.height > 70 || rect.width < 160 || rect.width > 520) return false;
        const children = Array.from(el.children || []).filter(isVisibleElement);
        if (children.length < 3 || children.length > 8) return false;
        const textValue = String(el.textContent || '').replace(/\s+/g, '');
        return /分享/.test(textValue) && (/\d/.test(textValue) || /(赞|评论|转发)/.test(textValue));
    }

    function findMomentDetailDeleteHost() {
        const fixedHost = document.querySelector('.ac-moment .member-feed-interactive .feed-interactive, .ac-moment .feed-interactive, .member-feed-interactive .feed-interactive');
        if (isVisibleElement(fixedHost)) return fixedHost;
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (!/分享/.test(node.nodeValue || '')) return NodeFilter.FILTER_REJECT;
                if (node.parentElement && node.parentElement.closest('#amp-inline-host')) return NodeFilter.FILTER_REJECT;
                return NodeFilter.FILTER_ACCEPT;
            },
        });
        let textNode = walker.nextNode();
        while (textNode) {
            let el = textNode.parentElement;
            for (let depth = 0; el && el !== document.body && depth < 6; depth++, el = el.parentElement) {
                if (isDetailActionRow(el)) return el;
            }
            textNode = walker.nextNode();
        }
        return null;
    }

    function mountMomentDetailDeleteButton() {
        const momentId = detailMomentIdFromLocation();
        if (!momentId || document.getElementById('amp-detail-delete')) return;
        const host = findMomentDetailDeleteHost();
        if (!host) return;
        const button = document.createElement('button');
        button.id = 'amp-detail-delete';
        button.className = 'amp-detail-delete';
        button.type = 'button';
        button.textContent = '删除';
        button.title = '删除这条动态';
        button.addEventListener('click', (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            deleteFeedMoment(momentId, null, button);
        });
        host.appendChild(button);
    }

    function scheduleMountMomentDetailDeleteButton() {
        if (!isMomentDetailPage()) return;
        window.clearTimeout(scheduleMountMomentDetailDeleteButton.timer);
        scheduleMountMomentDetailDeleteButton.timer = window.setTimeout(() => {
            mountMomentDetailDeleteButton();
            if (!document.getElementById('amp-detail-delete')) {
                scheduleMountMomentDetailDeleteButton.tries = (scheduleMountMomentDetailDeleteButton.tries || 0) + 1;
                if (scheduleMountMomentDetailDeleteButton.tries < 20) scheduleMountMomentDetailDeleteButton();
            }
        }, 250);
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

    // 已选图片：{file, objectURL, width, height}
    let picked = [];
    let emotionPackages = null;
    let emotionLoading = null;
    let emotionMap = readCachedEmotionMap();
    let activeEmotionPackageIndex = 0;
    let recentEmotionIds = readRecentEmotionIds();

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
                    return packages;
                })
                .finally(() => { emotionLoading = null; });
        }
        await emotionLoading;
        renderEmojiPanel();
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

    function startWhenBodyReady() {
        if (!document.body) {
            window.setTimeout(startWhenBodyReady, 30);
            return;
        }
        if (isMomentDetailPage()) {
            scheduleMountMomentDetailDeleteButton();
            return;
        }
        mountFloatingComposer();
    }
    startWhenBodyReady();

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
            text.innerHTML = '';
            closeComposerModal();
            const publicVisible = visibleInputs.find((input) => input.value === 'public');
            if (publicVisible) publicVisible.checked = true;
            updateCount();
            picked.forEach((p) => URL.revokeObjectURL(p.objectURL));
            picked = [];
            renderThumbs();
            send.disabled = false;
            send.textContent = '发布';
            window.location.reload();
        } catch (e) {
            msg.className = 'err';
            msg.textContent = e.message;
        } finally {
            send.disabled = false;
            send.textContent = '发布';
        }
    });
})();
