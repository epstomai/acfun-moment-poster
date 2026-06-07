# acfun-moment-poster

AcFun 网页端动态发布 Tampermonkey 脚本。

## 文件

- `acfun动态.user.js`：动态发布脚本。
- `acfun统计.user.js`：统计辅助脚本。
- `update-tampermonkey.py`：提升 userscript 版本并打开本地更新地址。
- `tampermonkey-update-server.py`：本地 Tampermonkey 更新服务。

## 更新到 Tampermonkey

```powershell
python update-tampermonkey.py
```

脚本会自动提升 `@version`，启动 `http://127.0.0.1:8787/` 本地服务，并打开 Chrome 更新页。

