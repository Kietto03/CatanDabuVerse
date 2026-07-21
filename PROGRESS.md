# Catan Project — Progress (cập nhật 2026-07-15)

Trạng thái tổng thể của game tính đến hiện tại. Chi tiết changelog kỹ thuật xem `IMPLEMENTATION_NOTES.md`; kế hoạch cải tiến giao diện xem `FRONTEND_REVAMP_PLAN.md`.

## 1. Tech stack
| Lớp | Công nghệ |
|---|---|
| Backend | `server.py` (~4.100 dòng) — FastAPI + python-socketio, **authoritative**. Chạy ASGI qua **`server:socket_app`** (không phải `server:app`). |
| Frontend | React 19 + Vite 8 + Tailwind v4 + Zustand 5 + **PixiJS 7** (board), socket.io-client. Serve từ `frontend/dist` → **phải `cd frontend && npm run build`** sau khi sửa FE. |
| Lưu trữ | SQLite `catan.db` (lịch sử ván qua `save_match`). |
| Chạy | `npm start` (= `.venv/bin/python server.py`, cổng 3000). |

## 1b. Bản đồ (Map layouts) — chọn map trước khi chơi ✨ (2026-07-21)
Board data-driven qua **registry `map_layouts.py`**: mỗi map cố định HÌNH (hex đất/biển/gold + ports), còn resource + số token random mỗi ván (tái dùng `assign_hex_numbers`, luật 6/8-không-kề). Người tạo phòng **chọn map ở Lobby** (grid card + mini-preview SVG `MapPreview.jsx`), VP tự set theo `defaultVP` của map. Endpoint `GET /api/maps` trả catalog (metadata + topology) cho FE.
- **Classic + Cities** (dùng chung): `standard` (19 hex), `large` (bàn lớn ~31 hex, 5–6 người).
- **Seafarers** (10 map chính thức Colonist/Catan Universe, dựng đúng HÌNH): `new_shores`, `four_islands`, `fog_island`, `through_desert`, `forgotten_tribe`, `pirate_islands`, `new_world`, `cloth_for_catan` (hai bờ + chuỗi đảo), `wonders` (lục địa 19-hex + 4 đảo), `greater_catan` (5–6p: lục địa chính + phụ + đảo). *Cơ chế con đặc thù (cloth/pirate-lair/tribe/wonders) chưa làm — các map chạy dưới luật Seafarers hiện có.*
- FE: `BoardCanvas` scale **auto-fit theo extent board** (thay hằng số cứng theo mode) → mọi cỡ map fit khung. Verified headless: 5 map (gồm bàn 91-hex) render + vào setup, **0 console error**; `/api/maps` & `/` HTTP 200; build FE sạch (giữ code-split).
- Thêm map mới = thêm 1 entry vào `MAPS` (khai báo land/water/gold + pool; ports auto hoặc `(q,r,side,type)`).

## 2. Các mode & mức độ hoàn thiện
| Mode | Trạng thái | Ghi chú |
|---|---|---|
| **Classic** (`basic`) | ✅ ~100% luật gốc | Số đỏ 6/8 không kề, đường không xuyên làng địch, Longest Road/Largest Army, robber + cướp có chọn mục tiêu, giới hạn quân, cảng 2:1/3:1, dev card đủ, trade P2P. |
| **Seafarers** (`seafarers`) | ✅ ~95% | Tàu (build/move), Longest Trade Route (đường+tàu), gold hex + chọn tài nguyên, pirate, VP đảo mới. Còn lại: cân bằng islet (thiết kế, không phải luật). |
| **Cities & Knights** (`cities`) | ✅ ~100% luật gốc | Xem mục 3. |
| ~~heroknight~~ | ❌ Đã xóa hẳn (2026-07) | `createRoom` từ chối mọi mode ngoài 3 giá trị trên. |

## 3. Cities & Knights — chi tiết
- **Kinh tế**: commodity coin/cloth/paper (thành trên ore/wood/sheep cho 1 tài nguyên + 1 commodity); 3 nhánh nâng cấp giá `n` commodity; **13 VP**; tắt dev card & Largest Army.
- **Metropolis (đúng luật gốc)**: giành ở **level 4** (+2 VP, biến 1 thành phố thành metropolis 4 VP); **cướp** từ chủ đang ở level 4 khi đạt level 5; **level 5 bảo vệ vĩnh viễn**. Helper `award_metropolis`.
- **Knights thật**: build/activate/promote/move (+displace), `chaseRobber`; `knight_strength`; City Wall.
- **Barbarian**: event die mỗi lượt; tấn công = số thành, phòng thủ = tổng level knight active; Defender of Catan (+1 VP); **hòa → mỗi người mạnh nhất rút 1 progress card**; thua → người yếu nhất mất 1 thành (metropolis được bảo vệ).
- **Passive abilities (mới, đủ luật gốc)**:
  - **Trade House** (Trade lv3): trả 2 commodity cùng loại → 1 tài nguyên/commodity bất kỳ.
  - **Aqueduct** (Science lv3): roll không ra gì (≠7) → chọn 1 tài nguyên.
  - **Fortress** (Politics lv3): mở khoá promote knight lên level 3.
- **Progress cards**: đủ **23/23 lá** + 2 lá VP; rút theo cổng màu, giới hạn tay 4.

## 4. Bot AI
**Heuristic (easy/medium/hard):** `do_bot_build_phase` — phân biệt độ khó, theo mode: xây city/road/settlement theo điểm pip, Seafarers đóng tàu, C&K tuyển/kích hoạt knight + nâng cấp → metropolis + tường + Warlord phòng thủ, mua dev card (non-cities). Làm nhiều hành động/lượt.

**🧠 AI (MCTS) — mode `basic` (2026-07-21):** loại bot mới `bot_mcts` (chọn ở Lobby: "🧠 AI (MCTS) — Classic"). Có **game engine headless** (`bot_ai/engine.py`, luật basic thuần, tách khỏi socket) + **MCTS/UCT** (`bot_ai/mcts.py`: open-loop, determinization thông tin ẩn, rollout heuristic, ngân sách thời gian ~350ms/quyết định, không cần train/GPU). Board dùng chung qua **`rules.py`** (tách `generate_board`/`assign_hex_numbers` khỏi server.py, không đụng logic). Tích hợp "MCTS quyết định — server thực thi": ở build-phase, snapshot `room`→engine (`bot_ai/bridge.py`), MCTS chọn build/city/road/buy/trade, áp vào room qua `apply_mcts_action`; **fallback heuristic** mọi lỗi + mọi mode ≠ basic (an toàn). *Đo được:* **MCTS thắng heuristic ~93%** (self-play, 150 sims, fair share 33%); engine giữ invariants (bảo toàn tài nguyên, determinism theo seed); live test: bot build đúng (giành Longest Road), **0 fallback, 0 console error**. Dev-card play + robber vẫn dùng heuristic; Seafarers/C&K = mở rộng engine đợt sau.

## 5. Kiểm thử đã chạy
- **7 unit test** (pure functions): metropolis claim→steal→protect, Aqueduct cấp/không cấp, barbarian tie → progress card. ✅ PASS.
- **Integration socket thật** (cities, 1 human + 3 bot): setup → playing → có **barbarian attack** thật, không crash, không lỗi server. ✅
- **UI headless thật** (Playwright + Google Chrome, store expose qua `window.useGameStore`): drive tạo phòng/đặt quân/tung xúc xắc, chụp màn hình + bắt console error cho cả basic & cities → **0 lỗi console** ở mọi kịch bản đã test.
- Server boot + serve `frontend/dist` HTTP 200. ✅

## 6. Frontend revamp (Light modern — chuẩn colonist.io)
> Đợt lớn 2026-07-15: nâng UI từ "cheap & buggy" lên **Light modern** (nền kem `#f4f1ea`, panel trắng bóng mềm, accent vàng cát `#c9852b`, dùng framer-motion). Kế hoạch đầy đủ: **`FRONTEND_REVAMP_PLAN.md`**.

**✅ P0 — Nền tảng**: `src/theme/tokens.css` (design token 1 chỗ) + `src/ui/index.jsx` (primitives Button/Panel/Card/Modal/Badge). Bỏ neo-brutalist (viền đen + bóng cứng).

**✅ P1 — Đồng bộ toàn UI**: Lobby, Scoreboard (top bar), ChatWidget, LeftNavBar, ExpansionPanel, PlayerDashboard (thanh + **mọi modal**: Trade/Dev/Discard/Steal) → light-modern, hết chắp vá.

**✅ P2 (slice an toàn, không rewrite renderer)**: ocean sáng lại (teal `#8fc4d4→#3d7d94`); **robber/pirate trượt** giữa hex (`token_slide`); **placement pop** (ring lan tỏa `place_pop` + quân **scale-in** easeOutBack qua `piecePop`).

**✅ P3 — Game-feel**: xúc xắc **lăn 3D** (framer-motion, spring-settle); **badge thành tựu + confetti** (`Celebration.jsx`) khi giành Longest Road/Largest Army/Metropolis; **tài nguyên bay về tay** (`flying_card`).

**🐛 Bug đã sửa (verify ảnh thật)**: "board đen khi tung xúc xắc" — trước đây làm mờ mọi hex ≠ số vừa tung suốt lượt; tung **7** → tối cả bàn. Đã sửa: chỉ highlight/mờ **thoáng qua lúc animation**, không mờ khi 7. Gia cố animation xúc xắc.

**✅ P4 — Responsive & polish (2026-07-16, verify headless thật)**:
- **Code-split bundle**: `vite.config.js` `manualChunks` (function-form — Vite 8/rolldown yêu cầu function, không phải object) tách `pixi` / `motion` / `vendor`; **BoardCanvas lazy-load** (`React.lazy` + `Suspense`). Kết quả: **initial load (lobby) ~136 KB gzip** (trước 1 file ~279 KB → **giảm ~51%**); chunk `pixi` (~139 KB gzip) **chỉ tải khi vào bàn** (đã verify qua network: lobby không tải pixi).
- **Reconnect overlay**: store thêm `connected` + listener `disconnect`/`reconnect_attempt`; `App.jsx` hiện overlay "Đang kết nối lại" khi mất socket.
- **prefers-reduced-motion**: bọc app trong `<MotionConfig reducedMotion="user">` (framer-motion tôn trọng OS setting; CSS-level đã có sẵn ở `tokens.css`).
- **Responsive**: `App.jsx` z-index qua token + offset responsive (`sm:`); ChatWidget width kẹp `min(20rem, 100vw-5rem)` + cao `min(380px,60vh)`; **ChatWidget + ExpansionPanel mặc định thu gọn khi `innerWidth < 900`** → bàn cờ hiển thị đầy đủ + chơi được trên mobile (390px, verify ảnh mobile-first).
- Verify: 0 console error ở desktop 1440 / tablet 820 / mobile 390 (mobile-first & resize).

### Việc còn lại
**Frontend:**
- **P2 chữ nét (2026-07-16, verify DPR=2)**: set `numText/labelText/anim.pixiText.resolution = devicePixelRatio` ở cả 3 site tạo `PIXI.Text` trong `BoardCanvas.jsx` — trước đây Text mặc định res 1 nên bị upscale mờ trên retina. Verify: chụp DPR=2 crop token → chữ số sắc cạnh, 0 console error. (Đây là phần "chữ nét" của P2, đạt an toàn không cần rewrite.)
- **P2 lớn (QUYẾT ĐỊNH: KHÔNG làm — 2026-07-16)**: scene-graph rewrite của BoardCanvas (immediate-mode → mỗi quân 1 Container bền vững + diff thay `g.clear()`). Lợi ích còn lại **chỉ là hiệu năng** (bớt churn tạo/hủy Text mỗi frame anim) + tween per-piece; phần "nhìn xịn" + "chữ nét" đã đạt. User chốt **dừng revamp ở đây** vì rủi ro cao (file 2.179 dòng, không phải git repo) không đáng cho lợi ích hiệu năng thuần. Nếu sau này thật sự thấy giật lag trên bàn lớn mới cân nhắc làm layer-by-layer.

**→ REVAMP FRONTEND COI NHƯ HOÀN THÀNH (P0–P4 + chữ nét).**
- ✅ **Scoreboard mobile fix (2026-07-21)**: bar dùng `flex-wrap`; roster xuống **hàng riêng full-width scroll** trên `<md`, hàng 1 giữ controls + barbarian tracker → không còn tràn/đẩy barbarian khỏi màn.
- ✅ **Polish (2026-07-21)**: flying-card phóng to (18×26→26×38, emoji 10→14); tên bot **đảm bảo duy nhất** (`get_bot_name(type, used)` — chọn tên chưa dùng, hết pool thì thêm hậu tố số); board effects Pixi (robber/pirate slide, place_pop, hex_press, flying_card) **tôn trọng `prefers-reduced-motion`** qua helper `prefersReducedMotion()`.

**Luật/gameplay:**
- ✅ **Cân bằng bàn Seafarers (2026-07-21)**: gộp 6 islet 1-hex thành **2 đảo 3-hex** ở vành ring-3 (tách khỏi đảo chính bởi vành nước ring-2) → VP đảo tối đa **+4** (trước +12), mỗi đảo đáng để đóng thuyền tới. Verified: `generate_board('seafarers')` → 13 land hex, main=7, 2 đảo size 3.

## 7. Cạm bẫy kỹ thuật cần nhớ
- `startGame` **xáo trộn thứ tự người chơi** → test/e2e phải tìm slot theo `username`, không giả định index 0.
- Cờ per-turn (crane/medicine/merchantFleet/forcedDice/bishop/ship & knight builtThisTurn…) reset trong `advance_turn`.
- `resolve_event_die`/`resolve_gold_after_roll` là no-op ngoài mode tương ứng → an toàn.
- Commodity coi như kho vô hạn (không đếm trong cap bank).
- FE: sửa xong **phải `cd frontend && npm run build`** (server phục vụ `frontend/dist`); design đổi 1 chỗ ở `src/theme/tokens.css`.
- macOS BSD `sed`: cần `-E` cho alternation `(a|b)` — `\|` im lặng không match.
