# Toki Bunny desktop pet / Toki Bunny 桌宠

This directory contains the single custom desktop-pet package bundled by this personal Toki edition.
本目录只包含这一套 Toki 自定义动态桌宠。

Runtime files are isolated under `package/` so the installer copies only:

```text
pet.json
spritesheet.webp
```

The atlas is a Codex v2 transparent WebP: `1536 x 2288`, eight `192 x 208` cells across and eleven rows down.
图集为 Codex v2 透明 WebP：`1536 x 2288`，横向 8 格、纵向 11 行，每格 `192 x 208`。

## Validate / 验证

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-toki-pet.ps1 -ValidateOnly
```

## Install or update / 安装或更新

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-toki-pet.ps1
```

The command validates a strict v2 manifest and transparent atlas, stages both files, validates the staged copy, and publishes it atomically under `%CODEX_HOME%\pets` or `%USERPROFILE%\.codex\pets`. Running it again safely replaces the same pet ID. It never edits `config.toml` or silently selects a pet.
脚本会严格验证 v2 manifest 与透明图集，暂存并复验两个运行文件，再原子发布到 `%CODEX_HOME%\pets` 或 `%USERPROFILE%\.codex\pets`；重复运行会安全更新同一 ID，且不会修改 `config.toml` 或自动选择桌宠。

After installation, open **Codex Settings > Pets**, choose **Refresh**, and select **Toki Bunny**.
安装后请打开 **Codex 设置 > Pets**，点击 **Refresh**，再选择 **Toki Bunny**。

QA evidence is under [`qa/`](./qa/). Redistribution considerations are recorded in [`NOTICE.md`](./NOTICE.md).
