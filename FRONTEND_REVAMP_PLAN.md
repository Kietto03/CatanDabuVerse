# Frontend Revamp Plan — nâng UI lên chuẩn "colonist.io"

Mục tiêu: biến giao diện từ cảm giác **"cheap & buggy"** thành **sạch, hiện đại, chuyển động mượt, dễ nhìn** — lấy [colonist.io](https://colonist.io) làm chuẩn tham chiếu.

> **Ràng buộc bất biến**: backend `server.py` là authoritative. Toàn bộ revamp chỉ đụng `frontend/src/**`. **Không đổi tên/parameter của socket event** (`createRoom`, `rollDice`, `buildSettlement`, `chooseGold`, `bankTrade`, …) và **không đổi shape của `gameState`**. UI chỉ đổi cách *hiển thị* state, không đổi *hợp đồng* dữ liệu.

---

## 1. Chuẩn tham chiếu — colonist.io có gì mà ta chưa có
| Yếu tố | colonist.io | Hiện tại của ta |
|---|---|---|
| Ngôn ngữ thị giác | Flat hiện đại, bo góc mềm, bóng đổ **mờ nhẹ nhiều lớp**, nền tối trung tính | **Neo-brutalist**: viền đen `border-3`, bóng **cứng** `shadow-[0_4px_0_#0f172a]` (25 chỗ) → trông cartoon/cheap |
| Bảng màu | 1 hệ màu nhất quán, muted-nhưng-vibrant | **49 mã hex rải rác**, không token → thiếu nhất quán |
| Board & quân cờ | Vector nét căng, **tween mượt** khi đặt/di chuyển | Pixi **immediate-mode redraw toàn bộ** mỗi update → quân "nhảy" vào chỗ, chữ dễ mờ, có nháy |
| Motion | Xúc xắc lăn, robber trượt, tài nguyên **bay về tay**, build "pop", chuyển lượt có transition | Chỉ vài CSS transition + `animate-shake/bounce/pulse`; board **không** tween |
| Layout | Khung cố định, cân đối, responsive | Panel nổi tuyệt đối + juggling `pointer-events`/z-index → dễ chồng/click nhầm ("buggy") |
| Phản hồi | Hover/aim rõ ràng, tooltip, trạng thái chờ | Có hover cơ bản; thiếu loading/empty/error state |

---

## 2. Chẩn đoán hiện trạng (theo code)
- `src/index.css` chỉ 18 dòng — gần như **không có design system**; mọi style nhét inline trong JSX.
- **Phong cách neo-brutalist** lặp lại thủ công khắp nơi (`border-3 border-slate-950 shadow-[0_4px_0_#0f172a]`) → khó đổi đồng loạt, trông rẻ tiền.
- `BoardCanvas.jsx` (2.078 dòng): một `mainGraphics` (PIXI.Graphics) bị **`clear()` + vẽ lại toàn bộ** mỗi lần state đổi; **0 `requestAnimationFrame`** cho nội suy; text vẽ immediate-mode → **mờ/nhảy**. Không có scene-graph tách quân cờ.
- `App.jsx`: các panel dùng `absolute` + `pointer-events-none/auto` lồng nhau → nguồn gốc cảm giác **buggy** (chồng lớp, vùng click chết).
- Chưa có thư viện motion (framer-motion/gsap) — mọi animation tự chế rời rạc.
- Component nặng: `PlayerDashboard.jsx` (1.110 dòng) trộn logic + UI + modal → khó polish.

---

## 3. Design System mới (nền tảng của mọi thứ)

Tạo `src/theme/tokens.css` (Tailwind v4 hỗ trợ `@theme`) — **1 nguồn sự thật** cho màu/typography/spacing/shadow/motion. Bỏ dần bóng cứng & viền đen.

### 3.1 Màu (design tokens, thay 49 hex rải rác) — **ĐÃ CHỐT: Light modern**
> Quyết định (2026-07): art direction = **Light modern** (nền kem, panel trắng bóng mềm, cảm giác boardgame giấy cao cấp); dùng **framer-motion** cho UI.
```css
@theme {
  /* Nền sáng ấm kiểu boardgame giấy */
  --color-bg:        #f4f1ea;   /* nền game (kem) */
  --color-surface:   #ffffff;   /* panel trắng + bóng mềm */
  --color-surface-2: #efe9dd;   /* vùng chìm nhẹ */
  --color-border:    #e2dccf;   /* viền mảnh 1px, ấm */
  --color-text:      #1e293b;
  --color-muted:     #6b7280;
  /* Accent nhất quán */
  --color-accent:    #c9852b;   /* vàng cát Catan (đậm hơn cho nền sáng) */
  --color-accent-2:  #2563eb;
  --color-danger:    #dc2626;
  --color-success:   #16a34a;
  /* Màu người chơi (đồng bộ với backend color slot) */
  --p-red:#d64545; --p-blue:#2f5fd6; --p-white:#c7ccd6; --p-orange:#e08a1e;
  /* Tài nguyên (dùng cả ở board lẫn card) */
  --r-wood:#3f7d3f; --r-brick:#c05a35; --r-sheep:#8ec46a; --r-wheat:#e5b63d; --r-ore:#7c8aa5;
}
```

### 3.2 Hình khối & bóng (bỏ neo-brutalist)
- Radius: `--radius-sm 8px / md 12px / lg 16px / pill 999px`.
- Bóng **mềm nhiều lớp**: `--shadow-1: 0 1px 2px rgba(0,0,0,.3); --shadow-2: 0 8px 24px -6px rgba(0,0,0,.45)`.
- Viền: `1px solid var(--color-border)` (bỏ `border-3` đen).
- Panel (light modern): `background: var(--color-surface)` trắng + `--shadow-2` bóng mềm + viền 1px ấm (không dùng kính mờ tối).

### 3.3 Typography
- 1 font hiển thị (vd **Inter** hoặc **Manrope**) qua `@font-face` self-host (không CDN). Weight 500/700/800.
- Thang cỡ chữ token hoá; **bỏ cỡ chữ siêu nhỏ `text-[9px]/[10px]`** rải rác (khó đọc → cảm giác cheap).

### 3.4 Motion tokens
- Easing: `--ease-out: cubic-bezier(.22,.61,.36,1)`, `--ease-spring` cho pop.
- Duration: `--t-fast 120ms / --t 200ms / --t-slow 360ms`.
- Nguyên tắc: mọi thay đổi trạng thái nhìn thấy được → có transition; không có gì "snap" đột ngột.

### 3.5 Component primitives (React)
Tạo `src/ui/`: `<Button variant tone size>`, `<Panel>`, `<Card>`, `<Badge>`, `<Modal>`, `<Tooltip>`, `<IconButton>`, `<ResourceChip>`. **Thay thế** style inline lặp lại → nhất quán tức thì và dễ đổi theme.

---

## 4. Kiến trúc rendering & animation

### 4.1 Board (PixiJS) — chuyển sang scene-graph có tween  *(hạng mục quan trọng nhất)*
Vấn đề gốc: vẽ lại toàn bộ mỗi frame. Giải pháp:
- **Tách layer bằng `PIXI.Container`**: `hexLayer` (tĩnh, vẽ 1 lần), `portLayer`, `edgeLayer`, `vertexLayer`, `pieceLayer` (quân), `tokenLayer` (robber/pirate/knight), `fxLayer` (hiệu ứng), `hoverLayer`.
- **Quân cờ = object bền vững**: mỗi settlement/city/road/ship/knight là 1 display object có `id`, **không destroy mỗi update**. Khi state đổi: diff → thêm/bớt/di chuyển object, rồi **tween** (`app.ticker` + lerp, hoặc `@pixi/tween`) vị trí/scale/alpha thay vì snap.
- **Chữ nét**: dùng `PIXI.BitmapText` hoặc set `resolution = devicePixelRatio` + `roundPixels`; number token vẽ 1 lần thành texture.
- **Hiệu ứng đặt quân**: scale-in "pop" + đổ bóng nhẹ; đường/tàu vẽ theo hiệu ứng "vẽ dần".
- Hover/aim: highlight ở `hoverLayer` mờ dần, không vẽ lại board.

### 4.2 UI React — thêm `framer-motion`
- Panel/modal/toast: enter/exit mượt (`AnimatePresence`), thay `animate-in` rời rạc.
- Card tài nguyên trên tay: layout animation khi thêm/bớt (bài trượt vào, không nhảy).
- Số VP/commodity: count-up khi đổi.

### 4.3 Animation theo sự kiện game (state-driven, đọc từ `gameState`)
| Sự kiện | Hiệu ứng | Nguồn state |
|---|---|---|
| Tung xúc xắc | 2 con lăn (sprite/CSS 3D) rồi dừng ở kết quả | `lastDiceRoll`, `diceRolled` |
| Nhận tài nguyên | Card **bay từ hex → tay** người chơi | diff số resource sau roll (đã có `distributions_log` trong log) |
| Robber/Pirate di chuyển | Token **trượt** hex→hex, bụi nhẹ | `robberHex` đổi |
| Đặt làng/thành/đường/tàu/knight | "Pop" + bụi | diff board |
| Barbarian tiến/tấn công (C&K) | Thanh threat rung, cờ đổ bộ | `barbarianStep`, log "reach Catan" |
| Longest Road / Largest Army / Metropolis | Badge bay lên + confetti nhỏ | `metropolisHolders`, `largestArmyHolder` |
| Chuyển lượt | Highlight người active trượt, viền phát sáng | `currentPlayerIndex` |
| Aqueduct/Gold choice | Modal chọn tài nguyên gọn (đã có) → thêm animation vào/ra | `gameState==='goldChoice'` |

---

## 5. Revamp từng khu vực

1. **Lobby** (`Lobby.jsx`): hero gọn, card chọn mode dạng **tile có ảnh/icon + trạng thái chọn phát sáng** (bỏ 3 mode → còn Classic/Seafarers/Cities); slider VP, danh sách slot màu người chơi, nút Ready/Start rõ ràng, "Copy invite link". Bỏ viền đen dày.
2. **Top bar / Scoreboard** (`Scoreboard.jsx`): thanh người chơi kiểu colonist — avatar màu, tên, VP, số thẻ (ẩn), icon Longest Road/Largest Army/Defender; **người active phát sáng**; threat barbarian gọn cho `cities`.
3. **PlayerDashboard / tay bài** (`PlayerDashboard.jsx`, tách nhỏ): khay tài nguyên **xoè như bài**, hover nhô lên; hàng nút hành động (Roll/Build/Trade/Buy/End) dạng icon + label, disabled state rõ; **tách modal** dev card / trade ra file riêng.
4. **ExpansionPanel** (`ExpansionPanel.jsx`): giữ chức năng (đã đầy đủ C&K/Seafarers) nhưng **thay style** sang panel kính mờ; barbarian track, commodity, 3 nhánh improvement (badge metropolis theo `metropolisHolders`), Trade House 2:1, roster knight, tay progress card. Modal chọn tham số card thống nhất `<Modal>`.
5. **ChatWidget / LeftNavBar**: đồng bộ token; chat có system-log tách biệt, cuộn mượt; nav icon có tooltip.
6. **BoardCanvas**: theo mục 4.1 — refactor lớn nhất.

---

## 6. UX, layout & chất lượng
- **Hệ thống layer 1 chỗ**: quản lý z-index + pointer-events tập trung (constants) thay vì rải rác → hết click nhầm/chồng panel.
- **Responsive**: dùng grid/flex + đơn vị tương đối; board tự fit; panel co gọn ở màn nhỏ / mobile (colonist chơi được trên mobile).
- **Loading / empty / error / reconnect**: skeleton khi vào phòng, toast lỗi thống nhất (đã có `errorMsg`), overlay "đang kết nối lại" khi mất socket.
- **Âm thanh**: giữ event `sound` sẵn có, thêm mixer volume + tôn trọng "reduce motion".
- **Accessibility**: tương phản màu đạt AA, focus ring, `prefers-reduced-motion` tắt animation nặng, aria cho nút.
- **Hiệu năng**: board không redraw toàn bộ; React memo hoá; tách `PlayerDashboard`; theo dõi bundle (hiện JS ~812 kB → cân nhắc code-split modal/hiệu ứng).

---

## 7. Roadmap phân kỳ (đề xuất thứ tự làm)

| Giai đoạn | Nội dung | Kết quả cảm nhận | Ước lượng |
|---|---|---|---|
| **P0 — Quick wins** | Design tokens + primitives (`Button/Panel/Card/Modal`); thay neo-brutalist bằng flat mềm; dọn z-index/pointer-events; sửa các cỡ chữ siêu nhỏ | Hết cảm giác "cheap", bớt "buggy" ngay | 1–2 ngày |
| **P1 — Design system hoá** | Áp token cho Lobby, Scoreboard, PlayerDashboard, ExpansionPanel, Chat, Nav; thêm `framer-motion` cho panel/modal/toast/hand | Giao diện đồng bộ, chuyển động UI mượt | 2–3 ngày |
| **P2 — Board motion** | Refactor BoardCanvas sang scene-graph + tween; chữ nét; hover layer; pop khi build; robber trượt | Board "sống", mượt như colonist | 3–5 ngày |
| **P3 — Game feel** | Dice roll, resource bay về tay, badge Longest Road/Army/Metropolis + confetti, chuyển lượt phát sáng, âm thanh + reduce-motion | Cảm giác "xịn", nhiều phản hồi | 2–3 ngày |
| **P4 — Responsive & polish** | Mobile/responsive, loading/reconnect states, a11y, tối ưu bundle | Chơi tốt mọi thiết bị | 2 ngày |

> Có thể giao P2 (BoardCanvas) và P1/P3 (React UI) cho 2 luồng song song vì ít đụng nhau.

---

## 8. Rủi ro & nguyên tắc
- **Không phá socket contract**: chỉ đổi hiển thị; test lại tất cả action sau mỗi giai đoạn (build FE + chơi thử 1 ván mỗi mode).
- **Refactor BoardCanvas rủi ro cao** (2.078 dòng, immediate-mode): làm sau khi design system ổn; giữ bản cũ để so sánh; refactor từng layer, không viết lại 1 lần.
- **Mỗi lần sửa FE phải `cd frontend && npm run build`** thì server mới phục vụ bản mới (`frontend/dist`).
- Ưu tiên self-host font/asset (không CDN) để tránh phụ thuộc mạng.

---

## 9. Bước tiếp theo đề xuất
Bắt đầu từ **P0**: dựng `src/theme/tokens.css` + bộ primitive `src/ui/*`, rồi thay phong cách neo-brutalist ở Lobby + Scoreboard làm mẫu để chốt "look". Sau khi bạn duyệt hướng thẩm mỹ (màu/độ bo/độ bóng), mới nhân rộng ra toàn app.
