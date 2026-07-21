# Catan Project — Implementation Notes / Changelog

Tổng hợp toàn bộ thay đổi backend (`server.py`) + frontend (`frontend/src/**`) qua các đợt làm.
Chi tiết thiết kế 2 mode mở rộng xem thêm `seafarers_cities_knights_plan.md`.

- **Backend**: `server.py` (~4050 dòng, FastAPI + python-socketio, authoritative). Chạy ASGI qua `server:socket_app` (KHÔNG phải `server:app` — `app` chỉ serve static, socket.io nằm ở `socket_app`).
- **Frontend**: React + PixiJS + Zustand, serve từ `frontend/dist` → **phải `cd frontend && npm run build`** sau khi sửa FE.
- **Modes**: `basic`, `seafarers` (Seafarers), `cities` (Cities & Knights đầy đủ). `createRoom` **từ chối** mode ngoài 3 giá trị này.

---

## 0. Đợt "100% backend + xóa heroknight" (mới nhất)

- **Xóa hẳn mode `heroknight`**: bỏ handler `trainKnight`, hàm `trigger_barbarian_attack`, 3 nhánh roll-site, nhánh bot; gỡ card mode + nút Train Knight + store method ở FE; Scoreboard threat indicator chuyển sang phục vụ `cities`. `createRoom` validate mode.
- **Metropolis đúng luật gốc** (trước đây sai ở level 5): hàm mới `award_metropolis()` — **giành ở level 4**, **cướp** từ chủ đang ở level 4 khi đạt level 5, **level 5 bất khả xâm phạm**. Dùng chung cho người chơi + bot. FE hiện badge 🏛️ theo `metropolisHolders` (không theo level 5).
- **Trade House (Trade lvl 3)**: `on_bank_trade` cho phép trả **2 commodity cùng loại → 1 tài nguyên/commodity bất kỳ**. FE có widget "🏪 Trade House (2:1)".
- **Aqueduct (Science lvl 3)**: trong `distribute_resources`, ai không nhận gì khi roll (không phải 7) được chọn 1 tài nguyên — tái dụng luồng `goldPending`/`goldChoice` (bot & timeout tự chọn). FE: picker gold/aqueduct dùng chung cho cả 2 mode.
- **Barbarian hòa** (nhiều người mạnh knight ngang nhau khi phòng thủ thắng): mỗi người hòa **rút 1 progress card** (helper `_grant_progress_card`) thay vì không được gì.
- **Kiểm thử**: 7 unit test (metropolis claim/steal/protect, Aqueduct có/không, hòa barbarian) PASS; integration socket thật (cities, 1 human + 3 bot) chạy qua setup → playing → có **barbarian attack** thật, không crash.

---

## 1. Base game — chuẩn hóa 100% so với luật gốc

| Fix | Vị trí | Ghi chú |
|---|---|---|
| Khóa backdoor `cheatResources` | `on_cheat_resources` | Chỉ chạy khi env `CATAN_DEBUG` bật |
| Thắng bằng **Longest Road** kích hoạt ngay | `check_road_victory()` | Gọi sau mọi `check_longest_road` lúc chơi (human + bot) |
| **Token xác thực reconnect** | `on_join_room` + `gameStore.js` | Mỗi ghế có `secret`; chống chiếm ghế / lộ dev card |
| **Số đỏ 6/8 không kề nhau** | `assign_hex_numbers()` | Reshuffle tới khi hợp lệ; test 200 board/mode |
| **Đường không đi xuyên làng/thành đối thủ** | `is_road_connection_valid()` | Áp cho người chơi + bot |
| Robber Seafarers khởi đầu trên hex nước | `on_create_room` | Bàn Seafarers không có sa mạc |

> Longest Road dùng "longest trail" (không lặp cạnh) — cách hiểu phổ biến, giữ nguyên.

---

## 2. Seafarers (mode `seafarers`) — backend ~95%

- **Tàu (ships)**: `buildShip` (1 gỗ + 1 cừu, cạnh biển, nối coastal/ship), `moveShip` (chỉ tàu hở đầu `is_ship_open_ended`, không phải tàu vừa đặt `builtThisTurn`, 1 tàu/lượt `shipMovedThisTurn`). Cạnh có `type` (`road`/`ship`) + cờ `sea`/`land`. Cap 15 tàu tách khỏi 15 đường.
- **Longest Trade Route**: `get_longest_road_for_player(..., allow_ships=True)` — gộp road + ship, chuyển loại chỉ tại làng/thành của mình.
- **Gold hex**: state `goldChoice` + handler `chooseGold`; bot & timeout tự chọn (`_auto_pick_gold`, `resolve_gold_after_roll`).
- **Pirate**: `movePirate` (thay robber khi tung 7, cướp người có tàu kề, chặn đặt tàu cạnh pirate).
- **VP đảo mới**: `award_island_vp` (+2 VP cho làng đầu tiên trên đảo phụ, **không** tính ở setup; Union-Find nhóm đảo trong `generate_board`, `mainIsland`).
- Board Seafarers có **1 hex gold**; robber start trên biển.

**Còn lại**: cân bằng islet (hiện 6 islet 1-hex = tối đa +12 VP đảo), bot ship AI đã có (xem mục 4).

---

## 3. Cities & Knights (mode `cities`) — backend ~95%, đủ 4 milestone

### M1 — Kinh tế "Cities"
- **Commodity** coin/cloth/paper: thành phố trên ore/wood/sheep cho **1 tài nguyên + 1 commodity**; ruộng/đồi vẫn 2 tài nguyên; làng không commodity.
- **3 nhánh nâng cấp** (`upgradeCityImprovement`): giá lên level *n* = *n* commodity; cần ≥1 thành phố.
- **Metropolis** ở level 5 (+2 VP, độc quyền người đầu tiên; đánh dấu `vertex['metropolis']` để barbarian không hạ).
- **City Wall** (`buildCityWall`): 2 gạch, +2 giới hạn tay/tường (≤3). Discard tính cả commodity (`hand_size`/`discard_limit`/`discard_random_cards`).
- Mục tiêu **13 VP**; **tắt** mua dev card & Largest Army trong mode này.

### M2 — Knights thật
Knight nằm trên `vertex['knight']` (tách khỏi owner/building):
- `buildKnight` (1 ore+1 sheep, ô trống nối đường, tối đa 6, `builtThisTurn`), `activateKnight` (1 wheat, không kích hoạt knight vừa xây), `promoteKnight` (1→2, 2→3 cần Politics≥3, ≤2/cấp).
- `moveKnight` — đi dọc mạng đường (`knight_reachable_vertices`), **displace** knight địch yếu hơn (relocate; hết chỗ → loại), tự bất hoạt.
- `chaseRobber` — knight active kề robber → vào `robberMove`.
- Xây làng bị chặn nếu ô có knight; `advance_turn` reset cờ per-turn; `knight_strength` = tổng level knight active.

### M3 — Barbarian + Event die
- **Event die** mỗi lượt (`resolve_event_die(room, red_die)`, gọi ở cả 3 site roll): 3 mặt tàu (barbarian +1, đủ 7 → tấn công + reset) + 3 cổng màu (rút progress card).
- **Barbarian tấn công** (`resolve_barbarian_attack_ck`): tấn công = **số thành**; phòng thủ = **tổng level knight active**. Thắng → quân mạnh nhất = **Defender of Catan (+1 VP)**; thua → người yếu nhất mất 1 thành → làng (metropolis được bảo vệ); sau đó mọi knight bất hoạt.

### M4 — Progress cards (đủ 23/23 lá + 2 lá VP)
- 3 bộ đúng phân phối gốc (Trade/Politics/Science, 18 lá/bộ = 54), tạo trong `startGame`.
- **Rút** khi cổng màu: người có `improvements[track] ≥ red die (d1)` rút 1 lá; giới hạn tay **4**; lá VP (Constitution/Printer) tự +1 VP.
- `playProgressCard` implement **toàn bộ 23 lá**:
  - *Science*: Alchemist (đặt xúc xắc), Road Building, Smith, Irrigation, Mining, Engineer, Crane, Medicine, Inventor.
  - *Politics*: Warlord, Saboteur, Bishop, Deserter, Diplomat, Intrigue, Spy, Wedding.
  - *Trade*: Resource Monopoly, Trade Monopoly, Merchant Fleet, Merchant, Master Merchant, Commercial Harbor.

**Còn lại**: vài passive ability nhánh (Aqueduct, tỉ giá 2:1 commodity của Trade cao…).

---

## 4. Bot AI — `do_bot_build_phase` (mọi mode + độ khó)

Trước đây bot **không** xây thành phố / tàu / knight và không phân biệt độ khó. Đã viết lại:
- **Xây thành phố** (mọi mode), **settlement/road** theo điểm ô (`_bot_vertex_score` = pip + đa dạng tài nguyên, `NUMBER_PIPS`).
- **Seafarers**: đóng tàu bành trướng. **heroknight**: train knight-counter. **Non-cities**: mua dev card (medium/hard).
- **Cities & Knights**: tuyển + kích hoạt knight (phòng thủ barbarian), nâng cấp thành phố → metropolis, tường thành, chơi Warlord khi barbarian gần.
- **Độ khó**: easy (random, ít), medium (best-half, có cities-advanced), hard (tối ưu theo pip, nhiều knight). `_bot_difficulty` map `bot_easy/medium/hard`.
- Bot làm **nhiều hành động/lượt** (loop ≤15) thay vì 1.

Đã test: unit 3 mode + ván thật (bot xây city/knight/road, barbarian raze thành), không crash.

---

## 5. Frontend Render

- **`ExpansionPanel.jsx`** (mới, nổi bên phải, không đụng UI cũ):
  - C&K: track barbarian + event die, kho commodity, 3 nhánh nâng cấp (nút upgrade), tường thành, roster knight (Activate/Promote/Move), tay progress card (Play cho lá đơn giản, modal chọn tham số cho Monopoly/Alchemist/Spy/Master Merchant, "Select…" cho lá chọn trên bàn).
  - Seafarers: nút Build/Move Ship + modal chọn Gold.
- **BoardCanvas** — hook `placementMode`: hover + click đặt **tàu / dời tàu / knight / dời knight / merchant / Intrigue / Diplomat / Deserter (2 click) / Inventor (2 click)**; Bishop chơi thẳng rồi dùng robber UI sẵn có.
- **Render pieces mới**: hex vàng (gold), quân **knight** (khiên màu chủ + chấm cấp + viền xanh khi active), sao **metropolis**, thuyền **pirate**.
- **Store** (`gameStore.js`): thêm `placementMode`/`setPlacementMode`/`clearPlacementMode` + method cho mọi action (buildShip/moveShip/movePirate/chooseGold/upgradeCityImprovement/buildCityWall/buildKnight/activateKnight/promoteKnight/moveKnight/chaseRobber/playProgressCard). Lobby thêm nút "Cities & Knights 🏛️".
- Frontend **build sạch**; server phục vụ `frontend/dist` (HTTP 200), state có đủ field mới.

**Còn lại (polish)**: hiển thị merchant piece trên bàn (hiện chỉ có hiệu ứng 2:1 + VP); một số hint/UX.

---

## 6. Việc còn lại (polish)

- Passive ability từng nhánh C&K: **Aqueduct** (Science ≥3: roll không ra gì → chọn 1 tài nguyên), tỉ giá 2:1 commodity của Trade cao.
- Cân bằng bàn Seafarers (gom islet thành đảo 2–3 hex, giảm tổng VP đảo).
- Vẽ merchant piece trên bàn.
- Kiểm thử tích hợp thêm với người chơi thật qua giao diện.

---

## Ghi chú kỹ thuật / cạm bẫy

- `startGame` **xáo trộn thứ tự người chơi** → test/e2e phải tìm slot human theo `username`, không giả định index 0.
- Progress-card / knight / ship dùng cờ per-turn — reset trong `advance_turn` (craneDiscount, medicineDiscount, merchantFleet, forcedDice, bishopActive, ship builtThisTurn, knight builtThisTurn/actedThisTurn).
- `resolve_event_die`/`resolve_gold_after_roll` là no-op ngoài mode tương ứng → an toàn cho base/heroknight.
- Commodities không đếm trong cap bank (unlimited, giữ đơn giản).
