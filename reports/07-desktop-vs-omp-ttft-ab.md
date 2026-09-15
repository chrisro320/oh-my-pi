# Devin Desktop 路徑 vs omp：同 payload 配對 TTFT 對照（結論）

**日期**：2026-09-14
**模型**：`swe-2`（omp `--thinking high`；Devin CLI `--model swe-2-high`）
**問題**：「Devin Desktop 的 TTFT 遠優於 omp，為什麼？」
**前置報告**：`06-omp-devin-ttft-audit.md`（§5.2 列出但未做的「決定性實驗」，本輪補上）

---

## 1. 結論

| # | 結論 | 證據 |
| :-- | :--- | :--- |
| 1 | **前提不成立：同 payload、同時段、配對交錯下，Desktop 同款 binary 與 omp 的 TTFT 無顯著差異。** p50 47.3s vs 43.8s；15 輪配對中 Devin 只有 6 輪較快 | §3，受控配對 n=15/臂 |
| 2 | 兩臂皆以「伺服器受理前等待」為主：omp `headersMs/ttftMs` 中位 ~0.78（區間 0.44–0.97） | §3.3 |
| 3 | **Desktop 的自動 keepalive 從未真正 ping**：今日互動會話日誌 10 個 loop 全 `sent=0 exit=Superseded`，`lead_idle` 是**停止**保活的理由 | §4，補上 06 報告 §10.2 的觀測缺口 |
| 4 | Desktop 自身互動會話的 TTFT 與 omp 同級：16 輪 p50 10.1s；30k 字元極小上下文 10.0s；閒置 13 分鐘後 127k token 回合 94s | §4 |
| 5 | 今日時段 swe-2 對 63k token payload 的前綴快取幾乎不生效：omp 相同內容間隔 1–2 分鐘連續 14 輪 `cacheRead=4096`（僅 system prompt/tools 段） | §3.4 |
| 6 | 兩端量測口徑一致：外部（spawn→首 stdout byte）與各自內部日誌只差 0.3–1.5s（程序啟動），**不存在「量測定義不同」造成的假差距** | §3.2 |

**對原問題的回答**：感受到的差距不是客戶端機制差異。最可能來源是比較時段不同（服務端狀態分鐘級漂移）、payload 不同、或單次抽樣落到快/慢節點。**omp 側沒有可修的本地槓桿**——連 Desktop 同款 binary 送同樣內容也一樣慢。

---

## 2. 方法

### 2.1 兩臂

| | Devin 臂 | omp 臂 |
| :--- | :--- | :--- |
| 執行檔 | `~/.local/share/devin/cli/_versions/3000.10.21/bin/devin -p --prompt-file …`（`-p` 內部同樣起 `devin acp` 子程序，與 Desktop 走同一路徑） | `omp -p --model swe-2 --thinking high --no-title --no-extensions --no-skills --no-rules @prompt` |
| 日誌 | `RUST_LOG=debug` → `~/.local/share/devin/cli/logs/devin_<ts>_<pid>.log`：`Connect POST …GetChatMessage` → `First token received` | `~/.omp/logs/omp.<date>.<pid>.log`：`devin: turn timing` 的 `ttftMs` / `headersMs`；session jsonl 取 `usage.input/cacheRead` |
| 工具數 | 25（官方預設） | 12 |

### 2.2 Payload

`/tmp/ab-ttft/filler-base.txt`：由本 repo 所有 `.md` + `patches/*.ts` 逐行打亂（seed 20260914）後截取 **200,000 字元**，前綴「Do not call any tools… reply with exactly: OK」。omp 實測 `input ≈ 62.9k token`。

兩臂**同一份檔案**；每輪順序輪換（偶數輪 devin 先，奇數輪 omp 先），臂間間隔 5s。

### 2.3 量測

- `first_byte`：spawn → 第一個 stdout byte（客戶端無關、使用者感知）
- `log_ttft`：各自日誌內部首字延遲
- 條件 warm：每輪相同內容（n=15/臂，完成）
- 條件 cold：每輪重排行序（**已中止，僅 1 筆，不採用**）

### 2.4 環境陷阱（供重現）

從 Desktop 派生的 shell 帶 `ACP_BACKEND=windsurf`，CLI 見到即拒用本機憑證（「ACP host is the sole source of credentials」）並回 `Not logged in`。啟動前需清掉 `ACP_BACKEND`、`WINDSURF_IDE_TYPE`、`WINDSURF_EXT_HOST_PID`。

---

## 3. 結果（warm，n=15/臂）

### 3.0 完整逐輪數據（秒；omp `input`/`cacheRead` 為 token）

| 輪 | 先發 | Devin first_byte | Devin log_ttft | omp first_byte | omp log_ttft | omp headers | omp input | omp cacheRead | Δ(devin−omp) |
| ---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | devin | 44.5 | 44.1 | 13.5 | 12.1 | 9.6 | 281 | 66,688 | +30.9 |
| 1 | omp | 33.3 | 32.9 | 87.4 | 85.9 | **61.1** | 62,865 | 4,096 | −54.1 |
| 2 | devin | 91.8 | 91.5 | 23.3 | 21.8 | 19.2 | 62,866 | 4,096 | +68.5 |
| 3 | omp | 96.2 | 95.8 | 43.8 | 42.2 | 40.5 | 62,861 | 4,096 | +52.4 |
| 4 | devin | 42.2 | 41.8 | 20.6 | 19.1 | 17.0 | 62,870 | 4,096 | +21.5 |
| 5 | omp | 71.0 | 70.5 | 11.0 | 9.5 | 7.2 | 62,864 | 4,096 | +60.0 |
| 6 | devin | 45.3 | 44.9 | 50.7 | 49.2 | 47.7 | 62,852 | 4,096 | −5.4 |
| 7 | omp | 131.1 | 130.7 | 37.6 | 36.2 | 34.5 | 62,870 | 4,096 | +93.4 |
| 8 | devin | 45.3 | 45.0 | 82.7 | 81.0 | **61.1** | 62,874 | 4,096 | −37.3 |
| 9 | omp | 17.2 | 16.8 | 140.5 | 139.0 | **60.9** | 62,855 | 4,096 | −123.3 |
| 10 | devin | 47.3 | 47.0 | 89.1 | 87.6 | **60.9** | 62,875 | 4,096 | −41.7 |
| 11 | omp | 29.3 | 28.9 | 91.1 | 89.4 | **61.1** | 62,870 | 4,096 | −61.8 |
| 12 | devin | 80.7 | 80.3 | 10.7 | 9.3 | 7.1 | 62,861 | 4,096 | +70.0 |
| 13 | omp | 64.1 | 63.7 | 10.4 | 8.9 | 7.2 | 62,857 | 4,096 | +53.6 |
| 14 | devin | 130.8 | 130.4 | 128.0 | 126.6 | **60.9** | 64,171 | 0 | +2.8 |

- 「先發」＝該輪先送出的臂；兩臂間隔 5s。
- Devin 臂日誌無 usage 欄位，故無 input/cacheRead。
- cold 條件僅完成 1 筆（r0 devin：first_byte 50.4 / log_ttft 49.9），已中止，不納入統計。
- 每輪兩臂各只送出**一次** `GetChatMessage`（omp 日誌 `devin: sending chat request` 每 run 恰一筆，無重試）。

### 3.1 分布（秒）

| 臂 | 指標 | min | p25 | p50 | p75 | max | mean |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| Devin | first_byte | 17.2 | 42.2 | **47.3** | 91.8 | 131.1 | 64.7 |
| Devin | log_ttft | 16.8 | 41.8 | 47.0 | 91.5 | 130.7 | 64.3 |
| omp | first_byte | 10.4 | 13.5 | **43.8** | 89.1 | 140.5 | 56.0 |
| omp | log_ttft | 8.9 | 12.1 | 42.2 | 87.6 | 139.0 | 54.5 |

### 3.2 配對差（devin − omp，秒，依輪次）

```
+30.9  -54.1  +68.5  +52.4  +21.5  +60.0  -5.4  +93.4  -37.3  -123.3  -41.7  -61.8  +70.0  +53.6  +2.8
```

Devin 較快：**6 / 15 輪**；中位差 +21.5s（方向偏 omp 略快），但單輪擺幅 ±120s，**不構成顯著差異**。

先後順序無系統性影響：devin 先發 p50 46.3 / 後發 64.1；omp 先發 43.8 / 後發 37.0。

外部與內部量測差：Devin 0.3–0.4s、omp 1.4–1.6s（皆為程序啟動開銷）。

### 3.3 延遲歸屬（omp 臂，有分段）

`headersMs / ttftMs`：`0.79 0.71 0.88 0.96 0.89 0.75 0.97 0.95 0.75 0.44 0.70 0.68 0.76 0.80 0.48`

→ 中位 ~0.78：大部分時間伺服器**尚未送出 response header**，屬受理前排隊，非 prefill。Devin 臂日誌無此分段，但整體分布同級。

**附帶觀察（未定論）**：omp 臂 15 輪中有 **6 輪 `headersMs` 落在 60.9–61.1s**（r1/r8/r9/r10/r11/r14），其餘 9 輪散布在 7–48s。omp 每 run 只送一次請求、無客戶端重試（`DEVIN_AUTH_EXPIRY_MARGIN_MS=60_000` 只影響 JWT 續期，不影響請求），故此 ~61s 是**伺服器側**的固定台階——形態像「受理佇列 60s 逾時後重派」。Devin 臂的 130.7 / 130.4s 兩筆亦約為 2×65s，但該臂無 headers 分段，不能確認。

### 3.4 前綴快取（omp 臂）

| 輪 | input | cacheRead |
| ---: | ---: | ---: |
| 0 | 281 | 66,688（命中：內容與先前手動試跑相同） |
| 1–13 | ~62,860 | **4,096**（連續 13 輪，僅 system prompt/tools 段） |
| 14 | 64,171 | 0 |

相同內容、間隔 1–2 分鐘、全部 miss。今日時段對 63k payload 的前綴快取近乎無效；「warm」條件實際等同 cold。Devin 臂 63k token 花 47s ≈ 1,340 tok/s，亦遠低於 06 報告量到的 4,000–4,700 tok/s → 伺服器整體慢，兩臂一起慢。

---

## 4. Desktop 自身互動會話（補 06 報告 §10.2 缺口）

來源：`~/.local/share/devin/cli/logs/devin_20260914-120112_115084.log`（session `abundant-gooseberry`，RUST_LOG=debug 全程）。

### 4.1 TTFT（POST GetChatMessage → First token received）

| 回合 | 上下文 | TTFT |
| :--- | :--- | ---: |
| `reply with exactly: PONG`（~30k 字元） | 極小 | 10.0s |
| 連續工具呼叫 5 輪 | 中 | 10.2 / 13.2 / 16.8 / 16.1s |
| 閒置 13 分鐘後（~127k token，同時觸發 compaction） | 大 | **94.0s** |
| 全部 16 輪 | — | p25 4.3 / **p50 10.1** / p75 16.8 |

對照 06 報告 omp 生產：暖 6.9s、冷 27.2s。**Desktop 未更快。**

### 4.2 keepalive 實況

```
my_gen=N shape=Continue model=swe-2-high  Starting keepalive pinging   ×10
my_gen=N sent=0 exit=Superseded          Loop ended                   ×10
old_gen=N reason="lead_idle"             Stopping keepalive pinging   ×4
old_gen=N reason="agent_stopping"        Stopping …                   ×4
old_gen=N reason="compaction"            Stopping …                   ×1
```

十個 loop **一次 ping 都沒送出**即被下一世代取代；主 agent 閒下來（`lead_idle`）是**停止**條件。「Desktop 靠自動 keepalive 保暖」不成立。

---

## 5. 對 06 報告的更新

| 06 報告條目 | 本輪 |
| :--- | :--- |
| §5.2「同 payload 乾淨對比」未做 | **已做**（warm n=15/臂）：無顯著差異 |
| §10.2 CLI `lead_idle` 保活場景未觀測 | **已觀測**：`sent=0`，未曾 ping |
| §10.5「能否對齊 CLI 保活」無法判斷 | **結案**：CLI 側無實際保活行為，無需對齊 |
| §11.3「差距＝payload 不對等，需同 payload 對照」 | 同 payload 後差距消失 |
| §3 前綴快取 TTL 6–12 分鐘 | 今日對 63k payload 間隔 1–2 分鐘即全 miss，比 TTL 結論更差；屬服務端狀態 |

---

## 6. 未定論／限制

- cold 條件未完成（中止），但 warm 條件實際上已是全 miss，等價於 cold。
- Devin 臂日誌無 `usage`，無法直接確認其快取命中；僅以 TTFT 同級推論。
- 單日單時段（13:15–14:00 本地）；服務端狀態分鐘級漂移，不排除其他時段兩臂差距方向不同——但這正是「差距來自服務端而非客戶端」的另一種表述。
- n=15/臂，擺幅 ±120s；只能排除「遠優於」，無法宣稱兩臂嚴格相等。

---

## 7. 產物

| 檔案 | 內容 |
| :--- | :--- |
| `/tmp/ab-ttft/ab.py` | 配對測試腳本 |
| `/tmp/ab-ttft/results.jsonl` | 原始數據（warm 30 筆 + cold 1 筆） |
| `/tmp/ab-ttft/filler-base.txt`、`prompt-warm-0.txt` | payload |
| `/tmp/ab-ttft/run-warm.log` | 逐輪輸出 |
| `~/.local/share/devin/cli/logs/devin_20260914-120112_115084.log` | Desktop 互動會話 debug 日誌 |
