import { getLang } from '../i18n';

const vi = {
  online: 'Online',
  back: 'Quay lại',
  loading: 'Đang kết nối…',
  connectFail: 'Không kết nối được máy chủ. Thử lại sau nhé!',
  retry: 'Thử lại',
  localMode: 'Chế độ thử nghiệm cục bộ — mở thêm tab để giả lập người chơi khác',
  'tab.play': 'Chơi',
  'tab.rank': 'Xếp hạng',
  'tab.profile': 'Hồ sơ',
  soon: 'Sắp có',
  'play.quick': 'Tìm trận xếp hạng',
  'play.quickSub': 'Ghép với người cùng trình • Tính điểm',
  'play.create': 'Tạo phòng',
  'play.createSub': 'Chơi với bạn bè • Có người xem & chat',
  'play.join': 'Vào bằng mã',
  'play.rooms': 'Phòng đang mở',
  'play.noRooms': 'Chưa có phòng nào. Tạo phòng đầu tiên đi!',
  'play.refresh': 'Làm mới',
  'profile.name': 'Tên hiển thị',
  'profile.save': 'Lưu',
  'profile.saved': 'Đã lưu!',
  'profile.avatar': 'Ảnh đại diện',
  'profile.country': 'Quốc gia',
  'profile.account': 'Tài khoản',
  'profile.guest': 'Tài khoản khách. Liên kết Google để giữ điểm khi đổi máy.',
  'profile.linkedAs': 'Đã liên kết Google: {email}',
  'profile.link': 'Liên kết Google',
  'profile.linked': 'Liên kết thành công!',
  'profile.switchT': 'Tài khoản Google này đã có hồ sơ',
  'profile.switchB': 'Chuyển sang hồ sơ đó? Tiến trình của tài khoản khách hiện tại sẽ không được gộp.',
  'profile.switch': 'Chuyển',
  'profile.switched': 'Đã chuyển sang tài khoản Google.',
  'profile.linkFail': 'Liên kết thất bại: {msg}',
  'profile.id': 'ID người chơi',
  'name.short': 'Tên quá ngắn (tối thiểu 3 ký tự)',
  'name.long': 'Tên quá dài (tối đa 16 ký tự)',
  'name.chars': 'Tên có ký tự không hợp lệ',
  'name.bad': 'Tên không phù hợp',
  rating: 'Điểm',
  games: 'Trận',
  winRate: 'Tỉ lệ thắng',
  cancel: 'Hủy',
} as const;

type Key = keyof typeof vi;

const en: Record<Key, string> = {
  online: 'Online',
  back: 'Back',
  loading: 'Connecting…',
  connectFail: 'Could not reach the server. Try again later!',
  retry: 'Retry',
  localMode: 'Local test mode — open more tabs to simulate other players',
  'tab.play': 'Play',
  'tab.rank': 'Ranking',
  'tab.profile': 'Profile',
  soon: 'Soon',
  'play.quick': 'Ranked match',
  'play.quickSub': 'Matched by skill • Rated',
  'play.create': 'Create room',
  'play.createSub': 'Play with friends • Spectators & chat',
  'play.join': 'Join with code',
  'play.rooms': 'Open rooms',
  'play.noRooms': 'No rooms yet. Create the first one!',
  'play.refresh': 'Refresh',
  'profile.name': 'Display name',
  'profile.save': 'Save',
  'profile.saved': 'Saved!',
  'profile.avatar': 'Avatar',
  'profile.country': 'Country',
  'profile.account': 'Account',
  'profile.guest': 'Guest account. Link Google to keep your progress across devices.',
  'profile.linkedAs': 'Linked to Google: {email}',
  'profile.link': 'Link Google',
  'profile.linked': 'Linked!',
  'profile.switchT': 'This Google account already has a profile',
  'profile.switchB': 'Switch to it? Progress of the current guest account will not be merged.',
  'profile.switch': 'Switch',
  'profile.switched': 'Switched to your Google account.',
  'profile.linkFail': 'Linking failed: {msg}',
  'profile.id': 'Player ID',
  'name.short': 'Name too short (min 3)',
  'name.long': 'Name too long (max 16)',
  'name.chars': 'Name has invalid characters',
  'name.bad': 'Please choose another name',
  rating: 'Rating',
  games: 'Games',
  winRate: 'Win rate',
  cancel: 'Cancel',
};

export type OKey = Key;

export function ot(key: Key, vars?: Record<string, string | number>): string {
  let s: string = (getLang() === 'vi' ? vi : en)[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** Escape text for innerHTML templates. */
export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
