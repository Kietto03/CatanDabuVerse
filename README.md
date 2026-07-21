# 🎲 CatanDabuVerse

Multiplayer **Catan** (Settlers of Catan) online — real-time, chơi với bạn bè và bot AI.
Backend authoritative bằng FastAPI + Socket.IO, frontend React + PixiJS. Hỗ trợ đầy đủ
3 biến thể luật gốc, nhiều bản đồ, và một **bot AI dùng MCTS**.

---

## ✨ Tính năng

### 3 chế độ chơi (đúng luật gốc)
| Mode | Mô tả |
|---|---|
| **Classic** (`basic`) | Catan cơ bản 19 hex: số đỏ 6/8 không kề, robber + cướp có chọn, Longest Road / Largest Army, dev card, cảng 2:1/3:1, trade P2P. |
| **Seafarers** (`seafarers`) | Tàu (build/move), Longest Trade Route (đường + tàu), ô vàng chọn tài nguyên, pirate, VP khám phá đảo. |
| **Cities & Knights** (`cities`) | Commodity (coin/cloth/paper), 3 nhánh nâng cấp thành + Metropolis, Knights, barbarian, 3 bộ progress card (đủ 23 lá). 13 VP. |

### Bản đồ đa dạng (chọn trước khi chơi)
Người tạo phòng chọn bản đồ ở Lobby (có ảnh preview). **12 map**:
- **Classic / Cities**: `Standard` (19 hex), `Big Board (5–6)` (~31 hex).
- **Seafarers** (10 scenario kiểu Colonist/Catan Universe): Heading for New Shores, The Four Islands,
  The Fog Island, Through the Desert, The Forgotten Tribe, The Pirate Islands, New World,
  Cloth for Catan, The Wonders of Catan, Greater Catan.

> Mỗi map cố định *hình* (đất/biển/ô vàng + ports); tài nguyên & số token random mỗi ván (luật 6/8 không kề).

### Bot AI
- **Heuristic** 3 mức: Dễ / Vừa / Khó (rule-based, hỗ trợ mọi mode).
- **🧠 AI (MCTS)** cho mode Classic: game engine headless + Monte Carlo Tree Search
  (không cần train/GPU). Thắng heuristic **~93%** trong self-play.

### Khác
- Real-time nhiều người + bot; reconnect; chat & nhật ký ván.
- Giao diện "light modern" (chuẩn colonist.io): animation xúc xắc, quân bay về tay, confetti thành tựu,
  responsive tới mobile, tôn trọng `prefers-reduced-motion`.

---

## 🚀 Chạy dự án

**Yêu cầu:** Python 3.11+ và Node 18+.

```bash
# 1. Backend deps
python -m venv .venv
.venv/bin/pip install -r requirements.txt

# 2. Build frontend (server phục vụ từ frontend/dist)
cd frontend && npm install && npm run build && cd ..

# 3. Chạy server (cổng 3000)
npm start          # = .venv/bin/python server.py  (uvicorn server:socket_app)
```

Mở **http://localhost:3000** → nhập tên → *Tạo phòng* → chọn mode + map + ghế (người/bot) → *Bắt đầu*.

> Sau khi sửa frontend phải chạy lại `cd frontend && npm run build`.
> Chạy ASGI qua `server:socket_app` (không phải `server:app`).

---

## 🧱 Tech stack

| Lớp | Công nghệ |
|---|---|
| Backend | `server.py` — FastAPI + python-socketio (**authoritative**), SQLite lưu lịch sử ván. |
| Frontend | React 19 + Vite 8 + Tailwind v4 + Zustand 5 + **PixiJS 7** (board) + framer-motion + socket.io-client. |
| Bot AI | `bot_ai/` — engine headless + MCTS thuần Python. |

---

## 📁 Cấu trúc

```
server.py            # game server authoritative (socket handlers, luật, bot heuristic)
rules.py             # sinh board (dùng chung server + engine)
map_layouts.py       # registry các bản đồ (topology + ports)
bot_ai/              # AI nâng cao (mode basic)
  ├── engine.py      #   game engine headless, deterministic
  ├── mcts.py        #   Monte Carlo Tree Search (UCT)
  ├── policy.py      #   heuristic dùng cho rollout + baseline
  ├── bridge.py      #   snapshot room -> engine state
  └── selfplay.py    #   harness đo win-rate + sanity tests
frontend/
  ├── src/           #   React app (components, store, theme, ui)
  └── dist/          #   bản build (npm run build) — server phục vụ từ đây
requirements.txt
```

**Tài liệu chi tiết:** [`PROGRESS.md`](PROGRESS.md) (tiến độ + changelog),
[`IMPLEMENTATION_NOTES.md`](IMPLEMENTATION_NOTES.md),
[`seafarers_cities_knights_plan.md`](seafarers_cities_knights_plan.md),
[`FRONTEND_REVAMP_PLAN.md`](FRONTEND_REVAMP_PLAN.md).

---

## 🧪 Kiểm thử nhanh

```bash
# self-play + sanity của bot MCTS (win-rate, determinism, bảo toàn tài nguyên)
.venv/bin/python -m bot_ai.selfplay
```

---

## 🗺️ Hướng phát triển tiếp

- Mở rộng engine MCTS sang Seafarers + Cities & Knights.
- Cho MCTS điều khiển cả dev-card play + robber.
- (Tuỳ chọn) bọc engine thành Gym env để train RL self-play.
