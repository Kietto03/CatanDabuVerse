# Seafarers & Cities and Knights — Đối chiếu luật gốc + Kế hoạch triển khai

> Tài liệu này (1) đánh giá 2 mode mở rộng hiện tại so với luật board game chính thức,
> (2) đưa ra kế hoạch triển khai đầy đủ. Base game đã được chuẩn hóa 100% (xem cuối file).

---

## PHẦN 0 — Trạng thái hiện tại (tóm tắt)

| Mode | Hiện có trong code | Kết luận |
|---|---|---|
| **Seafarers** (`seafarers`) | ✅ **Backend đã triển khai đầy đủ**: tàu (build/move), Longest Trade Route (road+ship), gold hex + chọn tài nguyên, pirate, VP đảo mới, robber khởi đầu trên biển. Còn thiếu: **frontend rendering**, **bot AI cho tàu**, tinh chỉnh cân bằng islet. | 🟡 Logic ~90%. Cần FE + bot để chơi trọn vẹn. |
| **Cities & Knights** — mode mới `cities` | 🟢 **M1+M2+M3+M4 đã triển khai backend**: commodity, nâng cấp thành phố + metropolis, city wall, knight thật, event die + barbarian (Defender/hạ thành), progress cards (3 bộ, rút theo cổng, 13/23 lá chơi được). Còn thiếu: 10 progress card phức tạp, vài ability nhánh (aqueduct…), bot C&K, và **FE render**. Mode `heroknight` cũ giữ nguyên. | 🟢 Logic ~90%. |

Cả 2 mode đều **không sai luật gây kẹt game**, nhưng khác xa bản mở rộng chính thức.

---

## PHẦN 1 — SEAFARERS

### 1.1 Luật gốc (những gì còn thiếu)

1. **Tàu (ship)** — loại "đường" thứ 2, đặt trên **cạnh biển** (cạnh giáp ít nhất 1 hex nước). Giá **1 gỗ + 1 cừu** (road vẫn 1 gỗ + 1 gạch trên cạnh đất).
2. **Tuyến tàu (shipping line)** phải bắt đầu từ **làng/thành ven biển** rồi nối tiếp bằng tàu; tàu nối tàu.
3. **Di chuyển tàu**: mỗi lượt được dời **1 tàu "hở đầu"** (tàu cuối tuyến, không kẹp giữa 2 công trình/tàu), trừ tàu vừa đặt trong lượt và tàu "đóng" (nối 2 làng của bạn).
4. **Longest Trade Route** thay cho Longest Road: đếm cả road + ship (≥5 → +2 VP).
5. **Gold hex** (`gold`): khi sản xuất, chủ được **chọn tài nguyên bất kỳ** (1 lá mỗi điểm khai thác).
6. **Pirate (cướp biển)**: giống robber nhưng ở hex biển; chặn **đặt tàu** cạnh nó và cướp của người có tàu kề. Khi tung 7 → chọn di chuyển robber **hoặc** pirate.
7. **VP đảo mới**: đặt làng đầu tiên lên đảo chưa ai ở → +2 VP (tùy kịch bản).
8. Mục tiêu thắng thường **13–14 VP** tùy kịch bản (không phải 10).

### 1.2 Thay đổi mô hình dữ liệu

```python
# Cạnh (edge): thêm loại
edge = {
  'id', 'v1', 'v2',
  'owner': None,
  'type': None,          # 'road' | 'ship'  (khi có owner)
  'builtThisTurn': False # phục vụ luật cấm dời tàu vừa đặt
}

# Hex: thêm loại địa hình
hex = { ..., 'resource': 'gold' | 'water' | ... }

# Room: thêm
room['pirateHex'] = {'q','r'} | None
room['shipMovedThisTurn'] = False   # mỗi lượt chỉ dời 1 tàu
room['discoveredIslands'] = set()   # nhóm hex-đảo đã có người ở (cho VP)
```

Phân biệt **cạnh biển vs cạnh đất**: precompute mỗi edge giáp mấy hex nước.
`edge_is_sea = any(hex is water for hex touching edge)`; road chỉ đặt trên cạnh có ≥1 hex đất, ship chỉ trên cạnh có ≥1 hex nước (cạnh bờ giáp cả 2 → cho phép cả road lẫn ship).

### 1.3 Luật cần code (server)

- `buildShip(edge_id)`: kiểm tra `edge` là cạnh biển & trống; tài nguyên 1 gỗ + 1 cừu; **kết nối**: 1 đầu là làng/thành ven biển của bạn **hoặc** 1 tàu của bạn (không nối qua đường bộ — road và ship là 2 mạng nối nhau chỉ tại **làng ven biển**). Đặt `type='ship'`, `builtThisTurn=True`.
- `moveShip(from_edge, to_edge)`: chỉ tàu hở đầu, không phải `builtThisTurn`, không phá vỡ tuyến; sau khi dời set `room['shipMovedThisTurn']=True`.
- **Longest Trade Route**: sửa `get_longest_road_for_player` để coi cả edge `road` và `ship` của người chơi là "đi được", nhưng đường đứt tại làng đối thủ (đã có) **và** tại điểm chuyển road↔ship không qua làng của bạn (thực tế: road và ship chỉ nối nhau ở làng/thành, nên DFS cần chặn chuyển loại tại vertex trống).
- **Gold hex** trong `distribute_resources`: nếu `resource=='gold'`, không tự cộng — thay vào đó đẩy vào hàng chờ `room['goldPending'][player_idx] += yield_amt` rồi chuyển state `goldChoice` để người chơi chọn (tương tự discard). Bot chọn ngẫu nhiên/theo nhu cầu.
- **Pirate**: `movePirate(q,r)` lên hex nước; khi tung 7 gửi cho FE lựa chọn robber/pirate. Pirate cướp từ người có **tàu** kề; cấm đặt tàu trên cạnh kề pirate.
- **VP đảo mới**: khi đặt làng, xác định "đảo" (thành phần liên thông các hex đất qua cạnh chung); nếu đảo đó chưa có ai và không phải đảo chính → +2 VP, đánh dấu `discoveredIslands`.
- Board generator: thêm 1 hex `gold`, cấu trúc đảo rõ ràng theo kịch bản "Heading for New Shores".

### 1.4 Frontend (`BoardCanvas.jsx`)

- Vẽ ship khác road (biểu tượng thuyền/nét đứt trên cạnh biển).
- Highlight cạnh biển hợp lệ khi ở chế độ đặt/dời tàu.
- Nút "Build Ship", "Move Ship"; modal chọn tài nguyên cho gold hex; UI chọn robber vs pirate.

### 1.5 Lộ trình (milestones)

- **M1 — Nền tàu** ✅ **ĐÃ LÀM (backend)**: loại cạnh `road`/`ship` + cờ `sea`/`land`, `buildShip` (1 gỗ + 1 cừu, cạnh biển, kết nối coastal/ship), Longest Trade Route gộp road+ship với luật chuyển loại chỉ tại làng. Cap 15 tàu tách khỏi 15 đường.
- **M2 — Gold + Pirate** ✅ **ĐÃ LÀM (backend)**: gold hex → state `goldChoice` + handler `chooseGold` (bot & timeout tự chọn); `movePirate` (thay robber khi tung 7, cướp người có tàu kề, chặn đặt tàu cạnh pirate).
- **M3 — Di chuyển tàu** ✅ **ĐÃ LÀM (backend)**: `moveShip` — chỉ tàu hở đầu (`is_ship_open_ended`), không phải tàu đặt trong lượt (`builtThisTurn`), 1 tàu/lượt (`shipMovedThisTurn`), phải còn nối mạng sau khi dời.
- **M4 — VP đảo mới** ✅ **ĐÃ LÀM (backend)**: `award_island_vp` +2 VP cho làng đầu tiên trên đảo phụ (không tính ở setup). Union-Find nhóm đảo trong board gen; robber Seafarers khởi đầu trên biển.
- **M5 — CÒN LẠI**:
  - **Frontend** (`BoardCanvas.jsx`): vẽ ship/pirate/gold, UI đặt & dời tàu, modal chọn gold, chọn robber↔pirate. (store đã có `buildShip/moveShip/movePirate/chooseGold`.)
  - **Bot** chưa biết đặt/dời tàu → trên Seafarers bot chỉ mở rộng trong đảo gốc. Cần AI ship.
  - **Cân bằng bàn**: hiện có 6 islet mỗi cái là 1 đảo 1-hex (tối đa +12 VP đảo) — hơi nhiều với mục tiêu 13 VP. Nên gom islet thành vài đảo 2–3 hex, hoặc giảm số islet.
  - **Mục tiêu VP**: Seafarers gốc thường 13; hiện lấy theo host chọn — nên set default 13 khi mode=seafarers.

**Đã test**: board gen (6/8, gold, sea/land, islands), ship connectivity, tách road/ship ở đỉnh trống, longest trade route (chuyển loại chỉ ở làng), open-ended, gold production + auto-resolve, island VP (setup=0 / play=+2), và smoke test end-to-end (tạo phòng → setup → playing → robber) không lỗi runtime.

---

## PHẦN 2 — CITIES & KNIGHTS

Đây là bản mở rộng **phức tạp nhất** của Catan. Cần đại tu sâu, không chỉ thêm biến đếm.

### 2.1 Luật gốc (những gì còn thiếu)

**a) 3 hàng hóa (commodities)** — thành phố sản xuất tài nguyên gốc + 1 commodity tùy địa hình:
| Địa hình | Làng (settlement) | Thành (city) |
|---|---|---|
| Núi (ore) | 1 ore | 1 ore + **1 coin** 🪙 |
| Rừng (wood) | 1 wood | 1 wood + **1 paper** 📜 |
| Đồng cỏ (sheep) | 1 sheep | 1 sheep + **1 cloth** 🧵 |
| Ruộng (wheat) | 1 wheat | 2 wheat |
| Đồi (brick) | 1 brick | 2 brick |

**b) 3 nhánh nâng cấp thành phố (city improvements)** — dùng commodity:
| Nhánh | Commodity | Màu | Ability chính |
|---|---|---|---|
| **Trade** | cloth 🧵 | vàng | Lvl3: 2:1 commodity; Lvl4: đổi bất kỳ; Lvl5 → **Metropolis** |
| **Politics** | coin 🪙 | xanh dương | Lvl3: promote knight lên lvl3 (Fortress); Lvl5 → Metropolis |
| **Science** | paper 📜 | xanh lá | Lvl1: Aqueduct (roll trắng → tự chọn 1 tài nguyên); Lvl5 → Metropolis |

Giá nâng lên level *n* = *n* commodity tương ứng (1,2,3,4,5). Level 5 → biến 1 thành phố thành **Metropolis** (=4 VP, +2 so với city). Mỗi nhánh chỉ có **1 metropolis** (ai đạt lvl5 trước giữ; người khác đạt lvl5 sau có thể "cướp" nếu chủ cũ chưa xây tường... — chi tiết theo rulebook).

**c) 3 con xúc xắc**: 2 xúc xắc số (đỏ+vàng) cho sản xuất (2–12 như cũ) + **1 event die** 6 mặt: 3 mặt **tàu barbarian** 🚢, 1 xanh dương (Politics), 1 xanh lá (Science), 1 vàng (Trade).
- Mặt tàu → barbarian tiến 1 bước (7 bước tới Catan).
- Mặt màu → nhìn **xúc xắc đỏ (1–6)**: người chơi có nhánh cùng màu ở level ≥ số đỏ → **rút 1 progress card** màu đó.

**d) Progress cards** — 3 bộ (Trade/Politics/Science), thay dev card. Rất nhiều lá hiệu ứng (Alchemist, Crane, Engineer, Bishop, Deserter, Intrigue, Spy, Merchant, Master Merchant, Resource/Trade Monopoly, Smith, Medicine, Mining, Irrigation, Printer/Constitution = VP...). Giới hạn tay 4 lá (trừ có cải tiến).

**e) Knights thật** (không phải biến đếm):
- **Xây** knight cơ bản (lvl1): 1 ore + 1 sheep, đặt lên **giao điểm trống nối mạng đường** của bạn.
- **Kích hoạt** (activate): 1 wheat — knight bất hoạt không làm gì.
- **Thăng cấp** (promote): lvl1→2 và 2→3 mỗi lần 1 ore + 1 sheep (lên lvl3 cần Politics ≥3).
- Knight **active** có thể: **di chuyển** dọc đường, **đánh bật** knight địch yếu hơn, **đuổi robber**, **phòng thủ barbarian**.
- Tối đa 6 knight/người (2 mỗi cấp). Sức mạnh phòng thủ = tổng level các knight **đang active**.

**f) Barbarian tấn công** (khi tàu tới Catan — bước 7):
- **Sức tấn công** = **tổng số THÀNH (city)** trên bàn (không phải làng).
- **Sức phòng thủ** = tổng level knight **active** của tất cả người chơi.
- Phòng thủ ≥ tấn công → thắng: người góp knight mạnh nhất = **Defender of Catan** (+1 VP; hòa → mỗi người rút 1 progress card).
- Phòng thủ < tấn công → thua: người góp **yếu nhất** bị **hạ 1 thành xuống làng** (không phá hủy).
- Sau đó: **mọi knight bị bất hoạt**, tàu barbarian reset về đầu.

**g) City Wall**: 2 gạch → tăng giới hạn tay từ 7 lên 9 (tối đa 2 tường → 11).

**h) Khác**: **Bỏ Largest Army** (knight thay thế); **giữ Longest Road**. Mục tiêu thắng **13 VP**. Robber chỉ ra khi đã có thành.

### 2.2 Thay đổi mô hình dữ liệu

```python
slot += {
  'commodities': {'coin':0, 'cloth':0, 'paper':0},
  'improvements': {'trade':0, 'politics':0, 'science':0},  # 0..5
  'knights': [ {'id','vertex','level':1..3,'active':bool} ],  # knight THẬT, đặt trên vertex
  'progressCards': {'trade':[], 'politics':[], 'science':[]},
  'metropolis': [],       # nhánh đang giữ metropolis
  'cityWalls': int,       # 0..3
  'defenderVP': int
}
room += {
  'barbarianStep': 0..7,
  'eventDie': None,       # 'ship'|'trade'|'politics'|'science'
  'redDie': 1..6,
  'aqueductPending': {},  # người có Science≥1 và roll không ra gì
  'metropolisHolders': {'trade':idx|None, ...}
}
vertex += { 'knight': {...} | None }   # knight chiếm giao điểm
```

### 2.3 Luật cần code (server) — theo cụm

1. **Sản xuất commodity**: sửa `distribute_resources` — city trên núi/rừng/cỏ cho thêm coin/paper/cloth; ruộng/đồi cho 2 tài nguyên (đã đúng), commodity cũng có "bank" riêng.
2. **Event die + red die**: sửa `rollDice` (và các nhánh bot/timeout) roll thêm event die; xử lý mặt tàu (barbarian++) và mặt màu (rút progress card cho ai đủ level). Aqueduct: nếu người có Science≥1 không nhận gì → cho chọn 1 tài nguyên.
3. **City improvements**: handler `upgradeImprovement(track)` trừ commodity theo level, cập nhật ability, xử lý metropolis (+2 VP, cướp metropolis, giới hạn 1/nhánh).
4. **Knights thật**: handlers `buildKnight(vertex)`, `activateKnight(id)`, `promoteKnight(id)`, `moveKnight(from,to)`, `knightDisplace`, `chaseRobberWithKnight`. Cần luật đặt/di chuyển theo mạng đường + đánh bật knight yếu hơn.
5. **Barbarian attack**: viết lại `trigger_barbarian_attack` theo luật (city vs active-knight-strength; Defender of Catan; hạ thành; bất hoạt knight).
6. **Progress cards**: 3 deck + ~24 hiệu ứng, giới hạn tay 4, 1 lá/lượt (một số lá không tính giới hạn).
7. **City Wall**: `buildCityWall` (2 gạch) tăng discard limit.
8. **Bỏ Largest Army** khi `gameMode=='cities'`; mục tiêu 13 VP.
9. **Turn state mới**: `activateKnights` / `knightActions` xen giữa build phase.

### 2.4 Frontend

- Thanh 3 nhánh cải tiến (0–5) + hiển thị metropolis.
- Kho commodity riêng (coin/cloth/paper).
- Vẽ knight trên giao điểm (level + active/inactive), UI build/activate/promote/move.
- Track barbarian 7 bước + event die animation.
- 3 tay progress card; modal Aqueduct; nút City Wall.

### 2.5 Lộ trình (milestones)

Mode key mới: **`cities`** (giữ `heroknight` cũ nguyên vẹn, không đụng).

- **M1 — Kinh tế "Cities"** ✅ **ĐÃ LÀM (backend)**:
  - Commodity coin/cloth/paper: thành phố trên ore/wood/sheep cho **1 tài nguyên + 1 commodity** (ruộng/đồi vẫn 2 tài nguyên); làng không cho commodity.
  - 3 nhánh nâng cấp (`upgradeCityImprovement`): giá lên level *n* = *n* commodity; phải có ≥1 thành phố.
  - **Metropolis** ở level 5 (+2 VP, độc quyền người đầu tiên đạt L5 mỗi nhánh).
  - **City Wall** (`buildCityWall`): 2 gạch, +2 giới hạn tay/tường (tối đa theo số thành, ≤3). Discard giờ tính cả commodity và ngưỡng theo tường.
  - Mục tiêu **13 VP**; **tắt** mua dev card & Largest Army trong mode này. Lobby đã có nút "Cities & Knights 🏛️".
  - Store FE: `upgradeCityImprovement`, `buildCityWall`.
- **M2 — Knights thật** ✅ **ĐÃ LÀM (backend)**: knight nằm trên `vertex['knight']` (tách khỏi owner/building nên không đụng production/robber/road).
  - `buildKnight` (1 ore + 1 sheep, ô trống nối đường, tối đa 6 knight, `builtThisTurn`).
  - `activateKnight` (1 wheat, không được kích hoạt knight vừa xây).
  - `promoteKnight` (1→2, 2→3; lên 3 cần Politics ≥ 3; tối đa 2 knight mỗi cấp).
  - `moveKnight` — đi dọc mạng đường (`knight_reachable_vertices`), **displace** knight địch yếu hơn (relocate knight bị đẩy, hết chỗ thì loại), tự bất hoạt sau khi hành động.
  - `chaseRobber` — knight active kề robber → vào `robberMove` để chủ dời robber; knight bất hoạt.
  - Xây làng bị chặn nếu ô có knight; `advance_turn` reset cờ per-turn knight (giữ trạng thái active). `knight_strength` = tổng level knight active (dùng cho barbarian M3).
  - Store FE: `buildKnight/activateKnight/promoteKnight/moveKnight/chaseRobber`.
- **M3 — Barbarian + Event die** ✅ **ĐÃ LÀM (backend)**:
  - **Event die** mỗi lượt (`resolve_event_die`): 3 mặt tàu + 3 cổng (trade/politics/science). Mặt tàu → barbarian tiến 1 (`barbarianStep`), đủ 7 → tấn công rồi reset. Cổng màu → log (rút progress card thuộc M4).
  - **Barbarian tấn công** (`resolve_barbarian_attack_ck`): sức tấn công = **số thành** (kể cả metropolis); phòng thủ = **tổng level knight active**. Hòa/thắng → quân mạnh nhất là **Defender of Catan (+1 VP)** (hòa nhiều người → không thưởng). Thua → người phòng thủ **yếu nhất** (có thành hạ được) mất 1 thành → làng (−1 VP); **metropolis được bảo vệ** (đánh dấu `vertex['metropolis']`). Sau trận: **mọi knight bất hoạt**.
  - Nối vào cả 3 site roll (human/bot/timeout), có guard gameover. `eventDie` trong sanitized state cho FE.
- **M4 — Progress cards** ✅ **ĐÃ LÀM (backend)**:
  - 3 bộ bài đúng phân phối gốc (Trade/Politics/Science, 18 lá mỗi bộ, tổng 54) tạo trong `startGame`.
  - **Rút** khi event die ra cổng màu: mọi người chơi có `improvements[track] ≥ red die (d1)` rút 1 lá của bộ đó (`_draw_progress_cards`). Giới hạn tay **4** (dư trả về đáy bộ). Lá VP (Constitution/Printer) tự cộng +1 VP khi rút.
  - `playProgressCard` — **13 lá implement đầy đủ**: Alchemist (đặt xúc xắc trước khi tung), Road Building, Smith (thăng 2 knight), Irrigation/Mining (+2 lúa/quặng mỗi hex kề), Engineer (tường miễn phí), Crane (giảm 1 commodity nâng cấp), Medicine (thành 2 ore+1 wheat), Warlord (kích hoạt mọi knight), Saboteur (đối thủ ≥ VP bỏ nửa bài), Resource Monopoly (lấy 2/đối thủ), Trade Monopoly (lấy 1 commodity/đối thủ), Merchant Fleet (2:1 một tài nguyên trong lượt).
  - `progressCards` (riêng) + `progressCardsCount` trong sanitized state; store FE `playProgressCard`.
- **M5a — 10 progress card còn lại** ✅ **ĐÃ LÀM (backend)**: Inventor (đổi token, trừ 2/6/8/12), Bishop (dời robber + cướp mọi người kề), Deserter (lấy knight địch + đặt knight cùng cấp), Diplomat (gỡ đường hở, của mình → xây lại free), Intrigue (đẩy knight địch trên đường mình), Spy (lấy 1 progress card của địch), Wedding (địch nhiều VP hơn cho 2 lá), Master Merchant (lấy 2 lá từ địch ≥ VP), Commercial Harbor (đổi commodity lấy resource với mỗi địch), Merchant (đặt merchant piece: 2:1 + 1 VP). **Đủ 23/23 lá + 2 lá VP.**
- **M5b — Bot AI (`do_bot_build_phase`)** ✅ **ĐÃ LÀM**: bot giờ **xây thành phố** (mọi mode), C&K **tuyển/kích hoạt knight + nâng cấp thành phố + tường + metropolis + Warlord phòng thủ**, Seafarers **đóng tàu bành trướng**, heroknight train knight, mua dev card (medium/hard). Phân biệt độ khó (easy random/ít, medium tốt-nửa, hard tối ưu theo pip + nhiều knight). Chọn vị trí theo điểm pip + đa dạng tài nguyên.
- **M5c — FE render** ✅ **ĐÃ LÀM**:
  - Component mới **`ExpansionPanel.jsx`** (nổi bên phải, không đụng UI cũ): C&K → track barbarian + event die, kho commodity, 3 nhánh nâng cấp (nút upgrade), tường thành, danh sách knight (Activate/Promote/Move), tay progress card (Play cho lá đơn giản, modal chọn tham số cho Monopoly/Alchemist/Spy…, "Select…" cho lá cần chọn trên bàn); Seafarers → nút Build/Move Ship + modal chọn Gold.
  - **BoardCanvas** hook `placementMode`: hover + click đặt **tàu / dời tàu / knight / dời knight / merchant / Intrigue / Diplomat / Deserter (2 click) / Inventor (2 click)**; Bishop chơi thẳng rồi vào robber UI sẵn có.
  - **Render pieces**: hex vàng (gold), quân **knight** (khiên màu chủ + chấm cấp + viền xanh khi active), sao **metropolis**, thuyền **pirate**. Store có `placementMode`/`setPlacementMode`/`clearPlacementMode`.
  - Frontend **build sạch**, server phục vụ `frontend/dist` OK.
- **Còn lại (polish)**: vài passive ability nhánh (Aqueduct, tỉ giá 2:1 commodity của Trade lvl cao…); tinh chỉnh cân bằng islet Seafarers; hiển thị merchant piece trên bàn (hiện chỉ có hiệu ứng 2:1 + VP).

**Đã test M1**: commodity production (city ore = 1 ore + 1 coin; basic vẫn 2 ore), hand_size/discard_limit theo tường, discard gộp commodity, upgrade 1→5 + metropolis độc quyền, cap L5, wall theo số thành, chặn upgrade khi thiếu commodity/không có thành. Regression base/seafarers/heroknight + smoke e2e (tạo phòng cities → setup → playing, VP=13, dev card bị chặn) không lỗi.

> ⚠️ Khối lượng M2–M4 vẫn lớn. Cân nhắc tách `modes/cities_knights.py` khi thêm knight/progress để `server.py` (đang ~3000 dòng) không quá tải.

---

## PHẦN 3 — Base game đã chuẩn hóa 100% (đã code trong lần này)

| Sửa | Vị trí | Trạng thái |
|---|---|---|
| Backdoor `cheatResources` khóa sau `CATAN_DEBUG` | `server.py` | ✅ |
| Thắng bằng Longest Road kích hoạt ngay (`check_road_victory`) | `server.py` | ✅ |
| Token xác thực reconnect (chống chiếm ghế/lộ bài) | `server.py` + `gameStore.js` | ✅ |
| **Số đỏ 6/8 không kề nhau** (`assign_hex_numbers`) | `server.py` | ✅ test 200 board/mode |
| **Đường không đi xuyên làng/thành đối thủ** (`is_road_connection_valid`) | `server.py` | ✅ test |
| Robber Seafarers khởi đầu trên hex nước (không chặn hex trung tâm) | `server.py` | ✅ |

Còn 1 điểm chấp nhận được: thuật toán Longest Road dùng "longest trail" (không lặp cạnh) — cách hiểu phổ biến và hợp lệ, giữ nguyên.
