ONLINE TETRIS 5 — 完全再構築版

■ 特徴
- 最大5人のオンライン対戦
- 4桁ルームコード
- ルーム作成 / 参加
- READY確認
- 部屋主だけがゲーム開始
- ライン消去によるおじゃまブロック
- スコア / ライン / レベル同期
- 切断時のルーム整理
- WebSocketの死活監視
- RenderなどのNode.js対応サービスで起動可能

■ 必要環境
Node.js 18以上

■ ローカル起動
1. このフォルダでターミナルを開く
2. npm install
3. npm start
4. http://localhost:3000 を開く

■ Renderへの公開
Build Command:
npm install

Start Command:
npm start

Environment:
PORTはRender側に任せてください。server.jsがprocess.env.PORTを使用します。

■ 操作
A = 左
D = 右
Z = 左回転
C = 右回転
S = ソフトドロップ
W / Space = ハードドロップ
Q = ホールド
P = ポーズ

■ ルーム
1. 1人目が「ルームを作る」
2. 表示された4桁コードを友達に共有
3. 他の人は同じコードを入力して「ルームに参加」
4. 全員READY
5. 部屋主が「ゲーム開始」

注意:
- 同じブラウザの別タブでも別プレイヤーとして接続できます。
- Renderなどでスリープする無料サービスでは、しばらくアクセスがないと起動に時間がかかる場合があります。
