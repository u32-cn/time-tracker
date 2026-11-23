# 安装说明

本页面给人与 AI 共用。按顺序执行即可，不要跳过校验。

## 1. 取版本元数据

```
GET https://time-tracker.u32.cn/data/win/latest.yml
```

返回形如：

```yaml
version: 0.3.4
path: download/win/time-tracker-setup-0.3.4.exe
files:
  - url: time-tracker-setup-0.3.4.exe
    size: 81802494
    sha256: 73879bd14227d1ca7d403c96f08aecac7b5401915a86ca9b8f5d6fcee9206720
```

记下 `version`、`size`、`sha256`。

## 2. 拼下载直链

```
https://time-tracker.u32.cn/download/win/time-tracker-setup-<version>.exe
```

这个路径由 EdgeOne 回源 GitHub Releases 的 `latest` 别名代理，跟着版本走，不需要知道 tag 号。

## 3. 下载并校验

```bash
curl -L -o time-tracker-setup.exe \
  "https://time-tracker.u32.cn/download/win/time-tracker-setup-0.3.4.exe"

# Windows
certutil -hashfile time-tracker-setup.exe SHA256
# Linux / macOS
sha256sum time-tracker-setup.exe
```

算出的哈希必须与第 1 步的 `sha256` 完全一致，字节数等于 `size`。不一致就删掉重下，不要安装。

## 4. 安装

双击 exe，选择安装目录。安装包未签名，Windows SmartScreen 会提示「已保护你的电脑」——点「更多信息 → 仍要运行」。

免安装版：解压 GitHub Release 资产中的 `win-unpacked` 压缩包，直接运行 `time-tracker.exe`。

## 5. 兜底通道

直链不通时，可临时改走 GitHub Releases：

```
https://github.com/u32-cn/time-tracker/releases/latest
```

国内访问 GitHub 不稳定，仅作兜底，校验步骤不能省。

## 常见问题

**提示「已保护你的电脑」** —— 未签名导致的 SmartScreen 拦截，不是病毒。点「更多信息」再点「仍要运行」。

**数据在哪** —— `%APPDATA%\每日学习计时器\data.json`，卸载不会删除，需要清空历史时手动删。

**从旧版本升级会丢记录吗** —— 不会。首次启动会自动把 `%APPDATA%\时间管理\data.json` 迁移过来。
