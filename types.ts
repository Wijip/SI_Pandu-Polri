
export enum RequestStatus {
  MENUNGGU = 'MENUNGGU',
  DIPROSES = 'DIPROSES',
  DITOLAK = 'DITOLAK',
  SELESAI = 'SELESAI'
}

export enum RequestPriority {
  NORMAL = 'Normal',
  PENTING = 'Penting',
  MENDESAK = 'Mendesak'
}

export enum UserRole {
  ADMIN = 'admin',
  USER = 'user',
  SUPERADMIN = 'superadmin'
}

export interface Personnel {
  id: string;
  nama: string;
  pangkat: string;
  nrp: string;
  jabatan: string;
  kesatuan: string;
  email: string;
  emailAlias?: string;
  status: string;
  role: UserRole;
  password?: string;
  passwordPlain?: string;
  internal?: string;
  foto?: string; // Properti baru untuk foto profil
  // Tambahan untuk Pengaturan
  telepon?: string;
  twoFactorEnabled?: boolean;
  notifEmailNewRequest?: boolean;
  notifWeeklyReport?: boolean;
}

export interface ResetRequest {
  id: string;
  nama: string;
  pangkat: string;
  nrp: string;
  jabatan: string;
  kesatuan: string;
  kontak_person?: string; // Field baru sesuai screenshot
  waktu_iso: string;
  status: RequestStatus;
  alasan: string;
  catatan?: string;
  dokumen_kta?: string;
  prioritas?: RequestPriority;
  createdAt: number;
  updatedAt?: number;
  reset_info?: {
    by: string;
    at_iso: string;
    password_set: boolean;
  };
  reset_password?: string;
  alasan_penolakan?: string;
}

export interface SiteSettings {
  name: string;
  logo: string | null;
  loginTitle?: string;
  loginSubtitle?: string;
  loginTagline1?: string;
  loginTagline2?: string;
  requestsTitle?: string;
  requestsSubtitle?: string;
  darkMode?: boolean;
}

export interface Notification {
  id: string;
  title: string;
  body: string;
  time: number;
  read: boolean;
  type: 'request' | 'system' | 'personnel';
  refId?: string;
}

export interface LogEntry {
  id: string;
  waktu: number;
  user: {
    nama: string;
    role: string;
    initials: string;
  };
  aktivitas: 'Reset Password' | 'Login' | 'Sistem' | 'Lainnya' | 'Update Data' | 'Hapus Data' | 'Pengaturan' | 'Import Data' | 'Tolak Permintaan';
  keterangan: string;
  ipAddress: string;
}
