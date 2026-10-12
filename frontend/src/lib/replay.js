import { applyPatch, deepClone } from 'fast-json-patch';
import { supabase } from './supabase';
import { useAuthStore } from '../store/authStore';

// Replay format (also the .catanreplay file, gzipped):
// { format: 'catanreplay', version: 1, match, participants, keyframes: [{seq, state}],
//   events: [{seq, turn_no, actor_seat, type, patch, log_lines}] }

const HTTP_ERRORS = {
  401: 'Hãy đăng nhập để xem replay này.',
  404: 'Không tìm thấy replay.',
  409: 'Ván này không có replay (ván chưa kết thúc).',
  410: 'Replay đã hết hạn và bị xoá khỏi máy chủ. Nếu bạn đã tải file replay, hãy mở file đó.',
};

const authHeader = () => {
  const token = useAuthStore.getState().session?.access_token;
  return token ? { Authorization: `Bearer ${token}` } : {};
};

function validate(replay) {
  if (!replay || replay.format !== 'catanreplay' || !Array.isArray(replay.keyframes) || !replay.keyframes.length) {
    throw new Error('File không phải replay Catan hợp lệ.');
  }
  if (replay.version > 1) throw new Error('Replay này được tạo bởi phiên bản mới hơn, hãy cập nhật trang.');
  return replay;
}

export async function fetchMatchReplay(matchId) {
  const res = await fetch(`/api/replays/${encodeURIComponent(matchId)}`, { headers: authHeader() });
  if (!res.ok) throw new Error(HTTP_ERRORS[res.status] || `Lỗi máy chủ (${res.status}).`);
  return validate(await res.json());
}

export async function fetchSharedReplay(token) {
  if (!supabase) throw new Error('Máy chủ chưa bật tính năng replay.');
  const { data, error } = await supabase.rpc('get_shared_replay', { p_token: token });
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Link replay không hợp lệ, đã bị thu hồi hoặc đã hết hạn.');
  return validate(data);
}

export async function readReplayFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text;
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) {        // gzip magic
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    text = await new Response(stream).text();
  } else {
    text = new TextDecoder().decode(bytes);
  }
  let parsed;
  try { parsed = JSON.parse(text); } catch { throw new Error('File không phải replay Catan hợp lệ.'); }
  return validate(parsed);
}

export async function downloadReplay(matchId) {
  const res = await fetch(`/api/replays/${encodeURIComponent(matchId)}/export`, { headers: authHeader() });
  if (!res.ok) throw new Error(HTTP_ERRORS[res.status] || `Lỗi máy chủ (${res.status}).`);
  const name = /filename="([^"]+)"/.exec(res.headers.get('content-disposition') || '')?.[1] || 'catan.catanreplay';
  const url = URL.createObjectURL(await res.blob());
  const a = Object.assign(document.createElement('a'), { href: url, download: name });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function createShareLink(matchId) {
  const uid = useAuthStore.getState().user?.id;
  const { data, error } = await supabase
    .from('replay_shares').insert({ match_id: matchId, created_by: uid }).select('token').single();
  if (error) throw new Error(error.message);
  return `${window.location.origin}/r/${data.token}`;
}

// A file picked on one screen and opened by the viewer route (/replay/file).
let pendingFile = null;
export const setPendingReplay = (replay) => { pendingFile = replay; };
export const takePendingReplay = () => pendingFile;

// ---------------------------------------------------------------------------
// Frame access: frame i shows the state after event frames[i] (frame 0 = start).
// Any frame = nearest keyframe at or before it + the patches after it.
// ---------------------------------------------------------------------------
export class ReplayCursor {
  constructor(replay) {
    this.keyframes = [...replay.keyframes].sort((a, b) => a.seq - b.seq);
    this.events = [...replay.events].sort((a, b) => a.seq - b.seq);
    this.frames = [this.keyframes[0].seq, ...this.events.filter((e) => e.seq > this.keyframes[0].seq).map((e) => e.seq)];
    this.bySeq = new Map(this.events.map((e) => [e.seq, e]));
    this.cache = { index: -1, state: null };
    // First frame of each turn, for "jump to turn".
    this.turnStarts = [];
    let last = -1;
    this.frames.forEach((seq, i) => {
      const t = this.bySeq.get(seq)?.turn_no ?? 0;
      if (t !== last) { this.turnStarts.push({ turn: t, index: i }); last = t; }
    });
  }

  get length() { return this.frames.length; }

  event(index) { return this.bySeq.get(this.frames[index]) || null; }

  turnOf(index) { return this.event(index)?.turn_no ?? 0; }

  stateAt(index) {
    index = Math.max(0, Math.min(index, this.frames.length - 1));
    const seq = this.frames[index];
    let doc;
    if (this.cache.state && index === this.cache.index + 1) {
      doc = deepClone(this.cache.state);                     // next frame: one patch
      applyPatch(doc, this.bySeq.get(seq).patch, false, true);
    } else {
      let kf = this.keyframes[0];
      for (const k of this.keyframes) { if (k.seq <= seq) kf = k; else break; }
      doc = deepClone(kf.state);
      for (const e of this.events) {
        if (e.seq <= kf.seq) continue;
        if (e.seq > seq) break;
        applyPatch(doc, e.patch, false, true);
      }
    }
    this.cache = { index, state: doc };
    return deepClone(doc);   // components get their own copy
  }
}
