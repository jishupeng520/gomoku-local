# 星星五子棋 · 局域网与在线大厅

## 本地运行

1. 双击 `启动五子棋.command`（macOS）或 `启动五子棋.bat`（Windows）。
2. 把终端显示的访问地址发给同事；同事打开后，在“在线大厅”中点击你的昵称并接受邀请。
3. 双方连接同一个局域网时使用本机 IP；部署到 Render 后直接使用 `https://你的服务名.onrender.com`。

## Render 部署

1. 将本目录推送到 GitHub/GitLab。
2. Render 控制台选择 **New → Blueprint**，选择仓库并使用 `render.yaml`；或新建 Node Web Service，Build Command 填 `npm ci --omit=dev`，Start Command 填 `npm start`。
3. 服务必须使用 Render 注入的 `PORT`，代码已经监听 `0.0.0.0`。

Render 免费服务空闲 15 分钟会休眠，唤醒可能需要约 1 分钟；在线玩家和房间是内存状态，服务重启后会清空。
