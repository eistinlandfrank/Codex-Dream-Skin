# Custom desktop pets on Windows / Windows 自定义桌宠

Codex owns the desktop-pet window, drag behavior, always-on-top state, and animation runtime. Dream Skin only keeps the auxiliary pet document transparent and installs a validated package in the per-user Codex pet directory. It does not patch `app.asar`, `WindowsApps`, signatures, authentication, or `config.toml`.

Codex 自身负责桌宠窗口、拖动、置顶与动画运行；Dream Skin 仅保证辅助窗口透明，并把经过验证的桌宠包安装到用户级 Codex pets 目录，不修改 `app.asar`、`WindowsApps`、签名、账号或 `config.toml`。

## Package contract / 包格式

A runtime package contains exactly:

```text
my-pet/
  pet.json
  spritesheet.webp
```

`pet.json` must use `spriteVersionNumber: 2` and `spritesheetPath: "spritesheet.webp"`. The spritesheet must be a transparent `1536 x 2288` WebP atlas: eight `192 x 208` cells across and eleven rows down.

## Generic validation and installation / 通用验证与安装

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\manage-pet-package.ps1 `
  -PackagePath C:\absolute\path\to\my-pet
```

Use `-Replace` to update an existing package with the same ID. The installer validates strict UTF-8 JSON, a safe lowercase ID, the exact v2 manifest, regular files with no link escape, size limits, exact atlas geometry, a real VP8/VP8L payload, and declared WebP alpha. It copies only the two runtime files, validates the staged copy, and publishes by same-volume directory rename under `%CODEX_HOME%\pets` or `%USERPROFILE%\.codex\pets`.

使用 `-Replace` 可更新同一 ID。安装器会检查严格 UTF-8 JSON、安全的小写 ID、精确 v2 manifest、无链接逃逸的普通文件、大小限制、准确图集尺寸、有效 VP8/VP8L 数据以及 WebP alpha；它只复制两个运行文件，复验暂存副本，再通过同卷目录重命名发布。

The Toki edition provides a repeat-safe wrapper:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install-toki-pet.ps1
```

Neither installer selects a pet. After installation, use **Codex Settings > Pets > Refresh** and select the pet explicitly.
两个安装入口都不会自动选择桌宠；安装完成后请在 **Codex 设置 > Pets > Refresh** 中手动选择。
