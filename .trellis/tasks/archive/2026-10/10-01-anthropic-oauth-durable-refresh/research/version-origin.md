# OAuth 缺陷版本來源

2026-10-01。OAuthVersionOrigin 只讀子代理調研，main 複核官方產物及代表性原文。

## 結論

不是 18.4.1 → 18.4.4 升級新增，也不是本機補丁鏈引入。三條路徑均見於官方上游。

| 缺陷 | 最早已確認 | 邊界與證據 |
|---|---|---|
| refresh 後 optional identity bootstrap 可超過10s刷新上限 | 至少16.1.17 | 子代理追到16.1.17；更早未確認，不能稱確切引入版本 |
| 發起者取消共享刷新，輪替後丟 token | 18.4.1 | main 讀18.4.0官方原文確認 unshared 不傳 caller signal；18.4.1開始傳入 |
| >15s停滯讓 lease 過期，成功CAS丟 token | 16.4.2 | 子代理確認16.4.1無lease；main讀16.4.2官方原文確認15s租約與僅背景續期，成功保存前未續期 |

## 官方位元組比較（main實際執行）

18.4.1：`/home/chris/.cache/omp-1841-upgrade/tgz-18.4.1/pi-ai.tgz`，用tar -xOf讀取指定member。
18.4.4：`/home/chris/.cache/omp-oauth-refresh.ctKEdY/upstream/package`，來源tarball SHA256 `14170ca4073dfc71b1498130ef8766e4e21aa0b8b6aac82e0047486ca49baea5`。

- `src/auth/refresh.ts`：Buffer.compare===0；SHA256 `315df3096f7bc9ce32434318e49566e72330c8be3674f3f64bc239ade1db7c6a`。
- `src/registry/oauth/anthropic.ts`：Buffer.compare===0；SHA256 `ab2abe1f1917f6697f34ce97d69d6cd4914e33765a4c3576c18bd4497b599d99`。

來源：
- https://unpkg.com/@oh-my-pi/pi-ai@18.4.0/src/auth/refresh.ts
- https://unpkg.com/@oh-my-pi/pi-ai@18.4.1/src/auth/refresh.ts
- https://unpkg.com/@oh-my-pi/pi-ai@16.4.2/src/auth-storage.ts
- https://unpkg.com/@oh-my-pi/pi-ai@16.4.1/src/auth-storage.ts
- https://unpkg.com/@oh-my-pi/pi-ai@16.1.17/src/registry/oauth/anthropic.ts

## 證據界限

歷史版本結論是source evidence，未對各歷史版跑runtime。本次18.4.4已做故障注入及真實loopback HTTP煙霧驗證，見verification.md。以上只能定位程式缺陷來源；沒有成功refresh→持久化的完整事故追蹤，不能指定哪一條造成credential31失效。credential19的服務端expired訊息亦不能單獨證明30天到期。
