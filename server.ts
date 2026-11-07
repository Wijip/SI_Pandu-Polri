import express from 'express';
import mysql from 'mysql2/promise';
import cors from 'cors';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import dotenv from 'dotenv';
import { Server } from 'socket.io';
import http from 'http';
import multer from 'multer';
import fs from 'fs';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';

import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { rateLimit } from 'express-rate-limit';
import sharp from 'sharp';
import crypto from 'crypto';
import net from 'net';

dotenv.config();

const app = express();

// --- TIER 2: DUAL-LAYER AUTHENTICATION RATE LIMITERS (FASE 11) ---

// 11.1 Layer 1: IP-Based Login Limiter (Toleran NAT Kantor: 30 percobaan / 15 menit per IP)
export const loginIpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 30, // 30 percobaan per 15 menit per IP (cukup ketat cegah bot spray, toleran LAN kantor)
  message: {
    success: false,
    message: "Terlalu banyak percobaan login dari IP Anda. Silakan coba lagi setelah 15 menit."
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: any) => process.env.NODE_ENV === 'test',
});
const publicRequestLimiter = loginIpLimiter; // Alias kompatibilitas

// 11.2 Layer 2: Account-Based Login Limiter (Anti-Targeted Brute Force: 5 percobaan / 15 menit per akun)
export const loginAccountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 5, // Batas ketat 5 percobaan per 15 menit per akun/email
  keyGenerator: (req: any) => {
    const identifier = (req.body?.email || req.body?.identifier || '').trim().toLowerCase();
    return `account:${identifier || 'anonymous'}`;
  },
  skip: (req: any) => process.env.NODE_ENV === 'test' || (!req.body?.email && !req.body?.identifier),
  message: {
    success: false,
    message: "Terlalu banyak percobaan login untuk akun ini. Silakan coba lagi setelah 15 menit demi keamanan akun Anda."
  },
  standardHeaders: true,
  legacyHeaders: false,
  validate: false, // Nonaktifkan validasi format IP karena menggunakan identifier akun
});

// 11.3 Penyelarasan Limiter MFA (5 percobaan / 5 menit per IP, selaras dengan TTL OTP 300 detik)
export const mfaVerifyLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 menit
  max: 5, // Diperketat menjadi maksimal 5 percobaan verifikasi OTP per 5 menit per IP
  message: {
    success: false,
    message: "Terlalu banyak percobaan verifikasi OTP dari IP Anda. Silakan coba lagi setelah 5 menit."
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: any) => process.env.NODE_ENV === 'test',
});

// 11.3 Limiter Ubah Password (5 percobaan / 15 menit per user/IP)
export const changePasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 5, // Maksimal 5 percobaan ubah password per 15 menit
  message: {
    success: false,
    message: "Terlalu banyak percobaan perubahan password dari IP Anda. Silakan coba lagi setelah 15 menit."
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: any) => process.env.NODE_ENV === 'test',
});

// --- TIER 1: GLOBAL API RATE LIMITER & PROTEKSI DASAR DOS (FASE 10) ---
export const globalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 500, // Batas 500 request per 15 menit per IP
  message: {
    success: false,
    message: "Terlalu banyak permintaan dari IP Anda, silakan coba lagi beberapa saat."
  },
  standardHeaders: true, // IETF RFC RateLimit-* headers (RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset)
  legacyHeaders: false, // Nonaktifkan header usang X-RateLimit-*
  skip: (req: any) => process.env.NODE_ENV === 'test', // Bypass otomatis saat automated testing suite berjalan
});

// --- TIER 3: HEAVY I/O & RESOURCE-INTENSIVE RATE LIMITERS (FASE 12) ---

// 12.1 Limiter Ekspor Data Excel & Unduh Template (10 request / 5 menit per user/IP)
export const exportLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 menit
  max: 10, // Maksimal 10 download per 5 menit (mencegah lonjakan RAM pembentukan workbook ExcelJS)
  message: {
    success: false,
    message: "Terlalu banyak permintaan ekspor data dari akun/IP Anda. Silakan tunggu beberapa saat sebelum mencoba kembali."
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: any) => process.env.NODE_ENV === 'test',
});

// 12.2 Limiter Operasi Batch Import File (5 request / 15 menit per user/IP)
export const importLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 5, // Maksimal 5 batch import per 15 menit (mencegah CPU spike & database lock contention)
  message: {
    success: false,
    message: "Terlalu banyak permintaan import data dari akun/IP Anda. Silakan tunggu beberapa saat demi stabilitas server."
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: any) => process.env.NODE_ENV === 'test',
});

// 12.3 Limiter Upload Berkas Dokumen KTA (20 upload / 15 menit per user/IP)
export const uploadKtaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 menit
  max: 20, // Maksimal 20 upload per 15 menit (mencegah disk I/O flooding & kompresi Sharp CPU overload)
  message: {
    success: false,
    message: "Terlalu banyak pengajuan dengan upload berkas dari IP Anda. Silakan coba lagi beberapa saat."
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req: any) => process.env.NODE_ENV === 'test',
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

// --- PENGAMANAN HARDCODED FALLBACK JWT SECRET (FASE 7.5) ---
if (!process.env.JWT_SECRET) {
  if (process.env.NODE_ENV === 'production') {
    console.error('FATAL ERROR: process.env.JWT_SECRET wajib dikonfigurasi di lingkungan produksi! Server dihentikan demi keamanan.');
    process.exit(1);
  } else {
    console.warn('⚠️ PERINGATAN KEAMANAN: process.env.JWT_SECRET belum dikonfigurasi. Menggunakan kunci rahasia fallback dev. JANGAN gunakan ini di production!');
  }
}
const PORT = parseInt(process.env.PORT || '3000', 10);
const JWT_SECRET = process.env.JWT_SECRET || 'polda-jatim-jwt-secret-2024';

// --- AUTENTIKASI KONEKSI SOCKET.IO HANDSHAKE SECURITY (FASE 7.3) ---
io.use((socket: any, next: any) => {
  try {
    const cookieHeader = socket.handshake.headers?.cookie;
    let token: string | null = null;

    if (cookieHeader) {
      const match = cookieHeader.match(/(?:^|;\s*)token=([^;]*)/);
      if (match) {
        token = decodeURIComponent(match[1]);
      }
    }

    if (!token && socket.handshake.auth && socket.handshake.auth.token) {
      token = socket.handshake.auth.token;
    }

    if (!token) {
      return next(new Error('Authentication error: Token JWT wajib disertakan'));
    }

    const decoded: any = jwt.verify(token, JWT_SECRET);
    if (!decoded || !decoded.id) {
      return next(new Error('Authentication error: Token JWT tidak valid'));
    }

    socket.user = decoded;
    next();
  } catch (err) {
    return next(new Error('Authentication error: Token tidak valid atau sesi telah berakhir'));
  }
});

// --- ENKRIPSI SIMETRIS AES-256-GCM UNTUK DATA AT-REST (FASE 5.1) ---
const getAesKey = (): Buffer => {
  return crypto.createHash('sha256').update(process.env.ENCRYPTION_KEY || JWT_SECRET || 'sipandu_polda_jatim_secure_aes256_key_2026').digest();
};

export const encryptResetPassword = (plainText: string): string => {
  if (!plainText) return plainText;
  if (typeof plainText === 'string' && plainText.startsWith('enc:gcm:')) {
    return plainText; // Idempotent: hindari double encryption
  }
  const key = getAesKey();
  const iv = crypto.randomBytes(12); // NIST 96-bit recommended IV for GCM
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `enc:gcm:${iv.toString('hex')}:${tag.toString('hex')}:${encrypted.toString('hex')}`;
};

export const decryptResetPassword = (cipherText: string | null | undefined): string | null | undefined => {
  if (cipherText === null || cipherText === undefined || cipherText === '') return cipherText;
  if (typeof cipherText !== 'string' || !cipherText.startsWith('enc:gcm:')) {
    return cipherText; // Graceful fallback: data legacy plaintext tetap terbaca mulus
  }
  try {
    const parts = cipherText.split(':');
    if (parts.length !== 5) {
      return cipherText;
    }
    const iv = Buffer.from(parts[2], 'hex');
    const tag = Buffer.from(parts[3], 'hex');
    const data = Buffer.from(parts[4], 'hex');
    const key = getAesKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(tag);
    const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
    return decrypted.toString('utf8');
  } catch (err) {
    console.error('[CRYPTO ERROR] Gagal mendeskripsi reset_password:', err);
    return cipherText;
  }
};

app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));
app.use(cookieParser());

// --- TIER 1: MOUNT GLOBAL API RATE LIMITER PADA SELURUH RUTE /api/* (FASE 10.1) ---
app.use('/api', globalApiLimiter);

// Health check endpoint
app.get('/api/health', (_req: any, res: any) => {
  res.json({ status: 'ok', db: dbConnected ? 'mysql' : 'disconnected' });
});

// Serve public uploads (e.g. logos)
app.use('/public_uploads', express.static(path.join(process.cwd(), 'public_uploads')));

// Nodemailer Transporter Configuration
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER || 'your-email@polda-jatim.go.id',
    pass: process.env.SMTP_PASS || 'your-app-password',
  },
});

// Middleware to check if user is Admin or Super Admin using JWT
const isAdmin = (req: any, res: any, next: any) => {
  const token = req.cookies.token;
  if (!token) {
    return res.status(401).json({ success: false, message: 'Sesi berakhir. Silakan login kembali.' });
  }

  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    if (decoded && (decoded.role === 'admin' || decoded.role === 'superadmin' || decoded.role === 'user')) {
      req.user = decoded;
      next();
    } else {
      res.status(403).json({ success: false, message: 'Akses ditolak. Hak akses tidak cukup.' });
    }
  } catch (error) {
    res.status(401).json({ success: false, message: 'Token tidak valid.' });
  }
};

// Middleware to strictly require Super Admin role using JWT (Fase 7.1)
const isSuperAdmin = (req: any, res: any, next: any) => {
  isAdmin(req, res, () => {
    if (req.user && req.user.role === 'superadmin') {
      next();
    } else {
      res.status(403).json({ success: false, message: 'Akses ditolak. Tindakan ini memerlukan hak akses Super Admin.' });
    }
  });
};

// Ensure private uploads directory exists
const PRIVATE_UPLOAD_DIR = path.join(process.cwd(), 'private_uploads', 'kta');
if (!fs.existsSync(PRIVATE_UPLOAD_DIR)) {
  fs.mkdirSync(PRIVATE_UPLOAD_DIR, { recursive: true });
}

// Multer Configuration for Private Storage
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, PRIVATE_UPLOAD_DIR);
  },
  filename: (_req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, file.fieldname + '-' + uniqueSuffix + path.extname(file.originalname));
  }
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 2 * 1024 * 1024 }, // 2MB limit as requested
  fileFilter: (_req, file, cb) => {
    const allowedMimeTypes = ['image/jpeg', 'image/png', 'application/pdf'];
    if (allowedMimeTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Format file tidak didukung. Hanya JPEG, PNG, dan PDF yang diperbolehkan.'));
    }
  }
});

// Database Configuration (MySQL Connection Pooling)
let mysqlPool: any;
let dbConnected = false;

// We export an adapter so the rest of the code works seamlessly whether
// standard pool queries or the app structure is used.
export const pool = {
  query: async (sql: string, params: any[] = []) => {
    if (!dbConnected) {
      console.warn("Database not connected, query skipped:", sql);
      return [[], []];
    }

    try {
      const [rows, fields] = await mysqlPool.query(sql, params);
      return [rows, fields];
    } catch (e) {
      // Prevent crashing node instance on query fail
      console.error("Query failed:", e);
      throw e;
    }
  },
  getConnection: async () => {
    if (!dbConnected || !mysqlPool) {
      throw new Error("Database not connected");
    }
    return await mysqlPool.getConnection();
  }
};

const safeAlterQuery = async (sql: string, params: any[] = []) => {
  if (!dbConnected || !mysqlPool) return null;
  try {
    const [rows, fields] = await mysqlPool.query(sql, params);
    return [rows, fields];
  } catch (err: any) {
    if (err.code === 'ER_DUP_KEYNAME' || err.errno === 1061 ||
      err.code === 'ER_DUP_FIELDNAME' || err.errno === 1060) {
      return null;
    }
    console.error(`Safe Alter Query failed:`, err);
    throw err;
  }
};

const safeDropIndexQuery = async (table: string, indexName: string) => {
  if (!dbConnected || !mysqlPool) return null;
  try {
    await mysqlPool.query(`ALTER TABLE \`${table}\` DROP INDEX \`${indexName}\``);
    return true;
  } catch (err: any) {
    if (err.code === 'ER_CANT_DROP_FIELD_OR_KEY' || err.errno === 1091) {
      return null;
    }
    console.warn(`[DATABASE] Catatan drop index ${indexName} dari ${table}:`, err.message);
    return null;
  }
};

const safeAddForeignKey = async (table: string, constraintName: string, fkSql: string) => {
  if (!dbConnected || !mysqlPool) return null;
  try {
    const [existing]: any = await mysqlPool.query(
      `SELECT CONSTRAINT_NAME FROM information_schema.TABLE_CONSTRAINTS 
       WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND CONSTRAINT_NAME = ?`,
      [table, constraintName]
    );
    if (existing && existing.length > 0) {
      return false; // Constraint sudah ada
    }
    await mysqlPool.query(fkSql);
    return true;
  } catch (err: any) {
    if (err.code === 'ER_FK_DUP_NAME' || err.code === 'ER_DUP_KEYNAME' || err.errno === 1826 || err.errno === 1061) {
      return false;
    }
    console.error(`[DATABASE ERROR] Failed to add FK ${constraintName} on ${table}:`, err.message);
    throw err;
  }
};

async function initializeDatabase() {
  try {
    console.log('[DATABASE] Connecting strictly to MySQL/MariaDB...');
    const dbName = process.env.DB_NAME || 'polda_jatim_reset';

    // Create initial connection without selecting a database to ensure it exists
    const initialPool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      port: parseInt(process.env.DB_PORT || '3306'),
      waitForConnections: true,
      connectionLimit: 1,
      connectTimeout: 10000
    });

    try {
      await initialPool.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci`);
      console.log(`[DATABASE] Database '${dbName}' siap digunakan/berhasil dibuat.`);
    } catch (e: any) {
      console.error(`[DATABASE ERROR] Gagal mengecek/membuat database '${dbName}': ${e.message}`);
    } finally {
      await initialPool.end();
    }

    // High-performance connection pooling with keep-alive and idle connection management
    mysqlPool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: dbName,
      port: parseInt(process.env.DB_PORT || '3306'),
      waitForConnections: true,
      connectionLimit: 20, // Scaled for concurrent multi-polres traffic
      maxIdle: 10, // Maintain warm connections for sub-millisecond query responses
      idleTimeout: 60000, // Reclaim stale connections after 60 seconds
      connectTimeout: 10000,
      queueLimit: 0,
      enableKeepAlive: true, // Prevent TCP socket teardowns under firewall/idle
      keepAliveInitialDelay: 10000,
      charset: 'utf8mb4',
      timezone: '+07:00' // WIB time zone alignment
    });

    // Test connection
    try {
      const conn = await mysqlPool.getConnection();
      dbConnected = true;
      conn.release();
      console.log(`[DATABASE] Connected successfully to MySQL database via Connection Pooling.`);
    } catch (e: any) {
      console.error(`[DATABASE ERROR] Failed to connect to MySQL: ${e.message}`);
      console.error(`[DATABASE ERROR] MySQL connection is strictly required. Server will not work without it.`);
      // Note: we let it continue rather than exit so the dev server stays up, but DB won't work
      return pool;
    }

    if (!dbConnected) return pool;
    console.log('[DATABASE] Memeriksa struktur tabel...');

    // Table: Personnel (with Soft Deletes and Security Flags)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS personnel (
        id VARCHAR(255) PRIMARY KEY,
        nama VARCHAR(255) NOT NULL,
        pangkat VARCHAR(100),
        nrp VARCHAR(100) UNIQUE NOT NULL,
        jabatan VARCHAR(255),
        kesatuan VARCHAR(255),
        email VARCHAR(255),
        role VARCHAR(50) DEFAULT 'user',
        password VARCHAR(255) NOT NULL,
        status VARCHAR(50) DEFAULT 'Aktif',
        foto VARCHAR(255) DEFAULT NULL,
        is_deleted BOOLEAN DEFAULT 0,
        lastLogin BIGINT,
        must_change_password BOOLEAN DEFAULT 0
      )
    `);

    // MIGRATION: Add must_change_password and password_encrypted to existing table dynamically
    await safeAlterQuery("ALTER TABLE personnel ADD COLUMN must_change_password TINYINT(1) DEFAULT 0");
    await safeAlterQuery("ALTER TABLE personnel ADD COLUMN telepon VARCHAR(50) DEFAULT NULL");
    await safeAlterQuery("ALTER TABLE personnel ADD COLUMN foto VARCHAR(255) DEFAULT NULL");
    await safeAlterQuery("ALTER TABLE personnel ADD COLUMN password_encrypted VARCHAR(255) DEFAULT NULL");
    await safeAlterQuery("ALTER TABLE personnel MODIFY COLUMN foto VARCHAR(255) DEFAULT NULL");
    await safeAlterQuery("ALTER TABLE personnel MODIFY COLUMN password VARCHAR(255) NOT NULL");

    // Prune redundant single-column & duplicate indexes that mislead query optimizer
    await safeDropIndexQuery('personnel', 'idx_kesatuan');
    await safeDropIndexQuery('personnel', 'idx_status');
    await safeDropIndexQuery('personnel', 'idx_nrp');
    await safeDropIndexQuery('personnel', 'idx_per_nrp_active');
    await safeDropIndexQuery('personnel', 'idx_email');

    // Add high-performance covering and composite indexes safely
    await safeAlterQuery("ALTER TABLE personnel ADD INDEX idx_per_active_nama (is_deleted, nama)");
    await safeAlterQuery("ALTER TABLE personnel ADD INDEX idx_per_active_unit_nama (is_deleted, kesatuan, nama)");
    await safeAlterQuery("ALTER TABLE personnel ADD INDEX idx_per_active_role (is_deleted, role)");
    await safeAlterQuery("ALTER TABLE personnel ADD INDEX idx_per_active_unit_role (is_deleted, kesatuan, role)");
    await safeAlterQuery("ALTER TABLE personnel ADD INDEX idx_per_email_active (email, is_deleted)");

    // Data normalization: enforce lowercase roles and trimmed spaces for clean indexing
    await pool.query("UPDATE personnel SET role = LOWER(role)");
    await pool.query("UPDATE personnel SET kesatuan = TRIM(kesatuan) WHERE kesatuan IS NOT NULL AND kesatuan != TRIM(kesatuan)");

    // Table: Reset Requests (with Soft Deletes)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS reset_requests (
        id VARCHAR(255) PRIMARY KEY,
        nama VARCHAR(255),
        pangkat VARCHAR(100),
        nrp VARCHAR(100),
        jabatan VARCHAR(255),
        kesatuan VARCHAR(255),
        kontak_person VARCHAR(255),
        waktu_iso VARCHAR(100),
        status VARCHAR(50) DEFAULT 'MENUNGGU',
        alasan TEXT,
        alasan_penolakan TEXT,
        catatan TEXT,
        dokumen_kta VARCHAR(255) DEFAULT NULL,
        prioritas VARCHAR(50),
        createdAt BIGINT,
        updatedAt BIGINT,
        reset_password VARCHAR(255) DEFAULT NULL,
        reset_info TEXT,
        is_deleted BOOLEAN DEFAULT 0
      )
    `);

    // Prune suboptimal single-column indexes that force filesort
    await safeDropIndexQuery('reset_requests', 'idx_req_kesatuan');
    await safeDropIndexQuery('reset_requests', 'idx_req_status');

    // MIGRATION: Optimize column data types to avoid off-page LOB allocation
    await safeAlterQuery("ALTER TABLE reset_requests MODIFY COLUMN dokumen_kta VARCHAR(255) DEFAULT NULL");
    await safeAlterQuery("ALTER TABLE reset_requests MODIFY COLUMN reset_password VARCHAR(255) DEFAULT NULL");

    // Add high-performance composite indexes for instant filtering & sorted streaming
    await safeAlterQuery("ALTER TABLE reset_requests ADD INDEX idx_req_active_created (is_deleted, createdAt DESC)");
    await safeAlterQuery("ALTER TABLE reset_requests ADD INDEX idx_req_active_status_created (is_deleted, status, createdAt DESC)");
    await safeAlterQuery("ALTER TABLE reset_requests ADD INDEX idx_req_active_unit_created (is_deleted, kesatuan, createdAt DESC)");
    await safeAlterQuery("ALTER TABLE reset_requests ADD INDEX idx_req_active_unit_status (is_deleted, kesatuan, status, createdAt DESC)");
    await safeAlterQuery("ALTER TABLE reset_requests ADD INDEX idx_req_active_nrp (is_deleted, nrp)");

    // Data normalization: trim trailing/leading spaces on kesatuan
    await pool.query("UPDATE reset_requests SET kesatuan = TRIM(kesatuan) WHERE kesatuan IS NOT NULL AND kesatuan != TRIM(kesatuan)");

    // MIGRATION: Add is_deleted column dynamically to avoid ER_BAD_FIELD_ERROR
    await safeAlterQuery("ALTER TABLE personnel ADD COLUMN is_deleted TINYINT(1) DEFAULT 0");
    await safeAlterQuery("ALTER TABLE reset_requests ADD COLUMN is_deleted TINYINT(1) DEFAULT 0");

    // Table: Units (Kesatuan)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS units (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nama VARCHAR(255) NOT NULL UNIQUE,
        tipe VARCHAR(100) NOT NULL,
        induk VARCHAR(255)
      )
    `);

    // Populate Units if empty
    const [unitCount]: any = await pool.query('SELECT COUNT(*) as count FROM units');
    if (unitCount && unitCount[0] && unitCount[0].count === 0) {
      console.log('[DATABASE] Menambahkan data referensi kesatuan...');
      const initialUnits = [
        { nama: 'Polda Jatim', tipe: 'POLDA', induk: null },
        { nama: 'POLRESTABES SURABAYA', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRESTA SIDOARJO', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRESTA BANYUWANGI', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES MALANG KOTA', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES GRESIK', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES MALANG', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES PASURUAN', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES PASURUAN KOTA', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES PROBOLINGGO', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES PROBOLINGGO KOTA', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES BATU', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES LUMAJANG', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES BONDOWOSO', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES SITUBONDO', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES JEMBER', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES KEDIRI', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES KEDIRI KOTA', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES TULUNGAGUNG', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES BLITAR', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES BLITAR KOTA', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES TRENGGALEK', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES NGANJUK', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES JOMBANG', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES MADIUN', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES MADIUN KOTA', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES NGAWI', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES MAGETAN', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES PONOROGO', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES PACITAN', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES BOJONEGORO', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES TUBAN', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES LAMONGAN', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES MOJOKERTO', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES MOJOKERTO KOTA', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES BANGKALAN', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES SAMPANG', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES PAMEKASAN', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES SUMENEP', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLRES PELABUHAN TANJUNG PERAK', tipe: 'POLRES', induk: 'Polda Jatim' },
        { nama: 'POLSEK GENTENG', tipe: 'POLSEK', induk: 'POLRESTABES SURABAYA' },
        { nama: 'POLSEK TEGALSARI', tipe: 'POLSEK', induk: 'POLRESTABES SURABAYA' },
        { nama: 'POLSEK BUBUTAN', tipe: 'POLSEK', induk: 'POLRESTABES SURABAYA' },
        { nama: 'POLSEK SIMOKERTO', tipe: 'POLSEK', induk: 'POLRESTABES SURABAYA' },
        { nama: 'POLSEK WONOKROMO', tipe: 'POLSEK', induk: 'POLRESTABES SURABAYA' },
        { nama: 'POLSEK SIDOARJO KOTA', tipe: 'POLSEK', induk: 'POLRESTA SIDOARJO' },
        { nama: 'POLSEK WARU', tipe: 'POLSEK', induk: 'POLRESTA SIDOARJO' },
        { nama: 'POLSEK GEDANGAN', tipe: 'POLSEK', induk: 'POLRESTA SIDOARJO' },
      ];

      for (const u of initialUnits) {
        await pool.query('INSERT INTO units (nama, tipe, induk) VALUES (?, ?, ?)', [u.nama, u.tipe, u.induk]);
      }
    }

    // Table: Logs
    await pool.query(`
      CREATE TABLE IF NOT EXISTS logs (
        id VARCHAR(255) PRIMARY KEY,
        waktu BIGINT,
        user_nama VARCHAR(255),
        user_role VARCHAR(100),
        aktivitas VARCHAR(255),
        keterangan TEXT,
        ipAddress VARCHAR(100)
      )
    `);

    await safeAlterQuery("ALTER TABLE logs ADD INDEX idx_logs_waktu (waktu DESC)");
    await safeAlterQuery("ALTER TABLE logs ADD INDEX idx_logs_aktivitas_waktu (aktivitas, waktu DESC)");
    await safeAlterQuery("ALTER TABLE logs ADD INDEX idx_logs_user_waktu (user_nama, waktu DESC)");

    // Table: OTP (Fase 9.1: One-way SHA-256 Code Hash & TempToken)
    await pool.query(`
      CREATE TABLE IF NOT EXISTS otp_codes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nrp VARCHAR(100) NOT NULL,
        code_hash VARCHAR(64) NOT NULL,
        expiresAt BIGINT NOT NULL,
        token VARCHAR(255),
        isUsed BOOLEAN DEFAULT 0,
        attempts INT DEFAULT 0
      )
    `);

    await safeAlterQuery("ALTER TABLE otp_codes ADD COLUMN code_hash VARCHAR(64) NOT NULL DEFAULT '0000000000000000000000000000000000000000000000000000000000000000' AFTER nrp");
    await safeAlterQuery("ALTER TABLE otp_codes ADD COLUMN attempts INT DEFAULT 0");
    await safeDropIndexQuery('otp_codes', 'idx_otp_expires');
    await safeAlterQuery("ALTER TABLE otp_codes ADD INDEX idx_otp_lookup (nrp, isUsed, expiresAt)");
    await safeAlterQuery("ALTER TABLE otp_codes ADD INDEX idx_otp_cleanup (expiresAt, isUsed)");

    // Table: Units index
    await safeAlterQuery("ALTER TABLE units ADD INDEX idx_units_induk (induk)");
    await pool.query("UPDATE units SET nama = TRIM(nama) WHERE nama IS NOT NULL AND nama != TRIM(nama)");

    // --- FASE 5.2: Standardisasi Relasi Kesatuan (Foreign Key Constraints) ---
    await safeAddForeignKey(
      'personnel',
      'fk_personnel_kesatuan',
      'ALTER TABLE personnel ADD CONSTRAINT fk_personnel_kesatuan FOREIGN KEY (kesatuan) REFERENCES units(nama) ON UPDATE CASCADE ON DELETE RESTRICT'
    );

    await safeAddForeignKey(
      'reset_requests',
      'fk_requests_kesatuan',
      'ALTER TABLE reset_requests ADD CONSTRAINT fk_requests_kesatuan FOREIGN KEY (kesatuan) REFERENCES units(nama) ON UPDATE CASCADE ON DELETE RESTRICT'
    );

    // --- FASE 5.1: Migrasi Enkripsi At-Rest untuk reset_requests.reset_password ---
    try {
      const [plainRows]: any = await pool.query(
        "SELECT id, reset_password FROM reset_requests WHERE reset_password IS NOT NULL AND reset_password != '' AND reset_password NOT LIKE 'enc:gcm:%'"
      );
      if (plainRows && plainRows.length > 0) {
        console.log(`[DATABASE SECURITY] Melakukan migrasi enkripsi AES-256-GCM pada ${plainRows.length} password tiket...`);
        for (const row of plainRows) {
          const encPass = encryptResetPassword(row.reset_password);
          await pool.query('UPDATE reset_requests SET reset_password = ? WHERE id = ?', [encPass, row.id]);
        }
        console.log('[DATABASE SECURITY] Migrasi enkripsi AES-256-GCM berhasil diselesaikan.');
      }
    } catch (migErr: any) {
      console.error('[DATABASE SECURITY ERROR] Gagal migrasi enkripsi reset_password:', migErr.message);
    }

    // Table: Site Settings
    await pool.query(`
      CREATE TABLE IF NOT EXISTS site_settings (
        id INT PRIMARY KEY CHECK (id = 1),
        name VARCHAR(255),
        logo VARCHAR(255),
        loginTitle VARCHAR(255),
        loginSubtitle VARCHAR(255),
        loginTagline1 VARCHAR(255),
        loginTagline2 VARCHAR(255),
        requestsTitle VARCHAR(255),
        requestsSubtitle VARCHAR(255),
        darkMode BOOLEAN DEFAULT 0
      )
    `);

    // Initialize default settings if not exists
    const [settingsRows] = await pool.query('SELECT * FROM site_settings WHERE id = 1');
    if (settingsRows && (settingsRows as any[]).length === 0) {
      await pool.query(`
        INSERT INTO site_settings (id, name, logo, loginTitle, loginSubtitle, loginTagline1, loginTagline2, requestsTitle, requestsSubtitle, darkMode)
        VALUES (1, 'Polda Jatim', '/img/Pandu.png', 'Reset Password Email Polri', 'Bid Tik Polda Jatim', 'MENGABDI DENGAN INTEGRITAS', 'MELAYANI DENGAN TEKNOLOGI', 'Manajemen Reset Password', 'PANTAU DAN EKSEKUSI PERMOHONAN AKSES PERSONEL', 0)
      `);
    } else {
      // Migrate old BIDTIK.webp logo to Pandu.png for existing database installations
      await pool.query(`UPDATE site_settings SET logo = '/img/Pandu.png' WHERE id = 1 AND logo = '/img/BIDTIK.webp'`);
    }

    // --- DEMO / DUMMY PERSONNEL DATA ---
    // Sesuai arahan Polda: NRP, Email, dan Password menggunakan data dummy (kecuali SA1 & SA2 untuk unit test)
    const mockPersonnel = [
      { id: "SA1", nama: "AKBP Budiono", pangkat: "AKBP", nrp: "75395964", jabatan: "Kabid Tik", kesatuan: "Polda Jatim", email: "superadmin1@polri.go.id", role: "superadmin", password: "superadmin123", status: "Aktif" },
      { id: "SA2", nama: "Kompol Siti Aminah", pangkat: "Kompol", nrp: "79421112", jabatan: "Kasubag Tekinfo", kesatuan: "Polda Jatim", email: "superadmin2@polri.go.id", role: "superadmin", password: "siperadmin123", status: "Aktif" },
      { id: "SA3", nama: "Super Admin Demo", pangkat: "Super Admin", nrp: "82081900", jabatan: "Super Admin Subbidtekinfo Bid Tik (Demo)", kesatuan: "Polda Jatim", email: "superadmin.demo@polri.go.id", role: "superadmin", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_URY_JATIM", nama: "Admin Polda Demo", pangkat: "Admin", nrp: "79529938", jabatan: "Admin Subbidtekinfo Bid Tik (Demo)", kesatuan: "Polda Jatim", email: "admin.polda.demo@polri.go.id", role: "admin", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010001", nama: "Polrestabes Surabaya", pangkat: "User", nrp: "84430628", jabatan: "Kasi Tik", kesatuan: "POLRESTABES SURABAYA", email: "sitik.surabaya@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010002", nama: "Polresta Sidoarjo", pangkat: "User", nrp: "75641897", jabatan: "Kasi Tik", kesatuan: "POLRESTA SIDOARJO", email: "sitik.sidoarjo@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010003", nama: "Polres Malang Kota", pangkat: "User", nrp: "77424444", jabatan: "Kasi Tik", kesatuan: "POLRES MALANG KOTA", email: "sitik.malangkota@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010004", nama: "Polresta Banyuwangi", pangkat: "User", nrp: "88664245", jabatan: "Kasi Tik", kesatuan: "POLRESTA BANYUWANGI", email: "sitik.banyuwangi@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010005", nama: "Polres Pelabuhan Tanjung Perak", pangkat: "User", nrp: "94460511", jabatan: "Kasi Tik", kesatuan: "POLRES PELABUHAN TANJUNG PERAK", email: "sitik.tanjungperak@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010006", nama: "Polres Gresik", pangkat: "User", nrp: "94574735", jabatan: "Kasi Tik", kesatuan: "POLRES GRESIK", email: "sitik.gresik@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010007", nama: "Polres Malang", pangkat: "User", nrp: "93622868", jabatan: "Kasi Tik", kesatuan: "POLRES MALANG", email: "sitik.malang@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010008", nama: "Polres Pasuruan", pangkat: "User", nrp: "97518874", jabatan: "Kasi Tik", kesatuan: "POLRES PASURUAN", email: "sitik.pasuruan@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010009", nama: "Polres Pasuruan Kota", pangkat: "User", nrp: "99620376", jabatan: "Kasi Tik", kesatuan: "POLRES PASURUAN KOTA", email: "sitik.pasuruankota@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010010", nama: "Polres Probolinggo", pangkat: "User", nrp: "80258671", jabatan: "Kasi Tik", kesatuan: "POLRES PROBOLINGGO", email: "sitik.probolinggo@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010011", nama: "Polres Probolinggo Kota", pangkat: "User", nrp: "78224502", jabatan: "Kasi Tik", kesatuan: "POLRES PROBOLINGGO KOTA", email: "sitik.probolinggokota@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010012", nama: "Polres Batu", pangkat: "User", nrp: "80542112", jabatan: "Kasi Tik", kesatuan: "POLRES BATU", email: "sitik.batu@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010013", nama: "Polres Lumajang", pangkat: "User", nrp: "98930671", jabatan: "Kasi Tik", kesatuan: "POLRES LUMAJANG", email: "sitik.lumajang@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010014", nama: "Polres Bondowoso", pangkat: "User", nrp: "84801779", jabatan: "Kasi Tik", kesatuan: "POLRES BONDOWOSO", email: "sitik.bondowoso@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010015", nama: "Polres Situbondo", pangkat: "User", nrp: "99884500", jabatan: "Kasi Tik", kesatuan: "POLRES SITUBONDO", email: "sitik.situbondo@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010016", nama: "Polres Jember", pangkat: "User", nrp: "89681711", jabatan: "Kasi Tik", kesatuan: "POLRES JEMBER", email: "sitik.jember@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010017", nama: "Polres Kediri", pangkat: "User", nrp: "81491066", jabatan: "Kasi Tik", kesatuan: "POLRES KEDIRI", email: "sitik.kediri@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010018", nama: "Polres Kediri Kota", pangkat: "User", nrp: "91287279", jabatan: "Kasi Tik", kesatuan: "POLRES KEDIRI KOTA", email: "sitik.kedirikota@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010019", nama: "Polres Tulungagung", pangkat: "User", nrp: "83788784", jabatan: "Kasi Tik", kesatuan: "POLRES TULUNGAGUNG", email: "sitik.tulungagung@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010020", nama: "Polres Blitar", pangkat: "User", nrp: "93946645", jabatan: "Kasi Tik", kesatuan: "POLRES BLITAR", email: "sitik.blitar@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010021", nama: "Polres Blitar Kota", pangkat: "User", nrp: "91607964", jabatan: "Kasi Tik", kesatuan: "POLRES BLITAR KOTA", email: "sitik.blitarkota@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010022", nama: "Polres Trenggalek", pangkat: "User", nrp: "93824512", jabatan: "Kasi Tik", kesatuan: "POLRES TRENGGALEK", email: "sitik.trenggalek@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010023", nama: "Polres Nganjuk", pangkat: "User", nrp: "87943721", jabatan: "Kasi Tik", kesatuan: "POLRES NGANJUK", email: "sitik.nganjuk@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010024", nama: "Polres Jombang", pangkat: "User", nrp: "88021938", jabatan: "Kasi Tik", kesatuan: "POLRES JOMBANG", email: "sitik.jombang@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010025", nama: "Polres Madiun", pangkat: "User", nrp: "86263039", jabatan: "Kasi Tik", kesatuan: "POLRES MADIUN", email: "sitik.madiun@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010026", nama: "Polres Madiun Kota", pangkat: "User", nrp: "83797316", jabatan: "Kasi Tik", kesatuan: "POLRES MADIUN KOTA", email: "sitik.madiunkota@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010027", nama: "Polres Ngawi", pangkat: "User", nrp: "80538094", jabatan: "Kasi Tik", kesatuan: "POLRES NGAWI", email: "sitik.ngawi@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010028", nama: "Polres Magetan", pangkat: "User", nrp: "98283647", jabatan: "Kasi Tik", kesatuan: "POLRES MAGETAN", email: "sitik.magetan@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010029", nama: "Polres Ponorogo", pangkat: "User", nrp: "90024552", jabatan: "Kasi Tik", kesatuan: "POLRES PONOROGO", email: "sitik.ponorogo@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010030", nama: "Polres Pacitan", pangkat: "User", nrp: "84595810", jabatan: "Kasi Tik", kesatuan: "POLRES PACITAN", email: "sitik.pacitan@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010031", nama: "Polres Bojonegoro", pangkat: "User", nrp: "86674562", jabatan: "Kasi Tik", kesatuan: "POLRES BOJONEGORO", email: "sitik.bojonegoro@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010032", nama: "Polres Tuban", pangkat: "User", nrp: "91857857", jabatan: "Kasi Tik", kesatuan: "POLRES TUBAN", email: "sitik.tuban@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010033", nama: "Polres Lamongan", pangkat: "User", nrp: "89461297", jabatan: "Kasi Tik", kesatuan: "POLRES LAMONGAN", email: "sitik.lamongan@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010034", nama: "Polres Mojokerto", pangkat: "User", nrp: "87372391", jabatan: "Kasi Tik", kesatuan: "POLRES MOJOKERTO", email: "sitik.mojokerto@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010035", nama: "Polres Mojokerto Kota", pangkat: "User", nrp: "84894299", jabatan: "Kasi Tik", kesatuan: "POLRES MOJOKERTO KOTA", email: "sitik.mojokertokota@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010036", nama: "Polres Bangkalan", pangkat: "User", nrp: "87360149", jabatan: "Kasi Tik", kesatuan: "POLRES BANGKALAN", email: "sitik.bangkalan@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010037", nama: "Polres Sampang", pangkat: "User", nrp: "81652398", jabatan: "Kasi Tik", kesatuan: "POLRES SAMPANG", email: "sitik.sampang@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010038", nama: "Polres Pamekasan", pangkat: "User", nrp: "84393303", jabatan: "Kasi Tik", kesatuan: "POLRES PAMEKASAN", email: "sitik.pamekasan@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010039", nama: "Polres Sumenep", pangkat: "User", nrp: "75378996", jabatan: "Kasi Tik", kesatuan: "POLRES SUMENEP", email: "sitik.sumenep@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" }
    ];

    // Insert Personnel ONLY if table is empty
    const [rows]: any = await pool.query('SELECT COUNT(*) as count FROM personnel');
    if (rows && rows[0] && rows[0].count === 0) {
      console.log('[DATABASE] Menginisialisasi data personel demo...');
      for (const p of mockPersonnel) {
        const hashedPassword = await bcrypt.hash(p.password, 10);
        const encryptedPassword = encryptResetPassword(p.password);
        await pool.query(`
          INSERT IGNORE INTO personnel (id, nama, pangkat, nrp, jabatan, kesatuan, email, role, password, password_encrypted, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [p.id, p.nama, p.pangkat, p.nrp, p.jabatan, p.kesatuan, p.email, p.role, hashedPassword, encryptedPassword, p.status]);
      }
    } else {
      // Ensure existing personnel records are synchronized with dummy credentials (preserving SA1 and SA2 for unit testing)
      for (const p of mockPersonnel) {
        if (p.id === 'SA1' || p.id === 'SA2') continue;
        const hashedPassword = await bcrypt.hash(p.password, 10);
        const encryptedPassword = encryptResetPassword(p.password);
        await pool.query(`
          UPDATE personnel 
          SET nama = ?, pangkat = ?, nrp = ?, jabatan = ?, email = ?, password = ?, password_encrypted = ?
          WHERE id = ?
        `, [p.nama, p.pangkat, p.nrp, p.jabatan, p.email, hashedPassword, encryptedPassword, p.id]);
      }
    }

    // Ensure SA1 and SA2 also have encrypted passwords stored
    await pool.query('UPDATE personnel SET password_encrypted = ? WHERE id = ? AND (password_encrypted IS NULL OR password_encrypted = "")', [encryptResetPassword('superadmin123'), 'SA1']);
    await pool.query('UPDATE personnel SET password_encrypted = ? WHERE id = ? AND (password_encrypted IS NULL OR password_encrypted = "")', [encryptResetPassword('siperadmin123'), 'SA2']);

    // Ensure any remaining records with NULL password_encrypted are backfilled with default password
    await pool.query('UPDATE personnel SET password_encrypted = ? WHERE password_encrypted IS NULL OR password_encrypted = ""', [encryptResetPassword('PasswordDemo123!')]);

    // Ensure users with completed reset requests have their password_encrypted synchronized with reset_requests
    try {
      await pool.query(`
        UPDATE personnel p 
        JOIN reset_requests r ON p.nrp = r.nrp 
        SET p.password_encrypted = r.reset_password 
        WHERE r.status = 'SELESAI' AND r.reset_password IS NOT NULL
      `);
    } catch (e: any) {
      console.warn('[DATABASE] Sync reset_requests to personnel password_encrypted skipped:', e.message);
    }

    // Ensure specific admin user exists in dummy form
    const targetEmail = 'admin.polda.demo@polri.go.id';
    const [targetUser]: any = await pool.query('SELECT * FROM personnel WHERE email = ?', [targetEmail]);
    if (targetUser && targetUser.length === 0) {
      console.log(`[DATABASE] Menambahkan user admin khusus: ${targetEmail}`);
      const hashedPassword = await bcrypt.hash('PasswordDemo123!', 10);
      const encryptedPassword = encryptResetPassword('PasswordDemo123!');
      await pool.query(`
        INSERT IGNORE INTO personnel (id, nama, pangkat, nrp, jabatan, kesatuan, email, role, password, password_encrypted, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        'ADM_URY_JATIM',
        'Admin Polda Demo',
        'Admin',
        '79529938',
        'Admin Subbidtekinfo Bid Tik (Demo)',
        'Polda Jatim',
        targetEmail,
        'admin',
        hashedPassword,
        encryptedPassword,
        'Aktif'
      ]);
    }

    console.log('[DATABASE] Inisialisasi selesai. Sistem siap digunakan.');
    return pool;
  } catch (error) {
    console.error('[DATABASE] Peringatan inisialisasi database:', error);
    return pool;
  }
}

async function startServer() {
  const pool = await initializeDatabase();

  // Comprehensive automated database maintenance routine
  const runDatabaseMaintenance = async () => {
    try {
      // 1. Purge expired OTP records older than 24 hours
      await pool.query('DELETE FROM otp_codes WHERE expiresAt < ?', [Date.now() - (24 * 60 * 60 * 1000)]);
      // 2. Prune old audit logs older than 180 days to keep query execution instantaneous
      const sixMonthsAgo = Date.now() - (180 * 24 * 60 * 60 * 1000);
      await pool.query('DELETE FROM logs WHERE waktu < ?', [sixMonthsAgo]);
      // 3. Keep InnoDB optimizer statistics fresh
      await pool.query('ANALYZE TABLE personnel, reset_requests, logs, otp_codes, units');
      console.log('[DATABASE] Pemeliharaan & optimasi berkala selesai.');
    } catch (e) {
      console.error('[DATABASE] Gagal menjalankan pemeliharaan berkala:', e);
    }
  };
  runDatabaseMaintenance();
  setInterval(runDatabaseMaintenance, 12 * 60 * 60 * 1000); // Run every 12 hours

  // API Routes
  app.get('/api/units', isAdmin, async (req: any, res: any) => {
    try {
      let query = 'SELECT * FROM units';
      let params: any[] = [];

      // Role-based filtering for units list (indexed seek via utf8mb4 collation)
      if (req.user.role !== 'superadmin') {
        query += ' WHERE nama = TRIM(?)';
        params.push(req.user.kesatuan || '');
      }

      // Order by hierarchy: POLDA first, then POLRES, then POLSEK, then alphabetically
      query += ` ORDER BY 
        CASE 
          WHEN tipe = 'POLDA' THEN 1 
          WHEN tipe = 'POLRES' THEN 2 
          WHEN tipe = 'POLSEK' THEN 3 
          ELSE 4 
        END ASC, 
        nama ASC`;

      const [rows]: any = await pool.query(query, params);
      res.json({ success: true, data: rows });
    } catch (error) {
      console.error('Failed to fetch units:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data kesatuan' });
    }
  });

  // --- SETTINGS ROUTES ---
  app.get('/api/settings', async (req: any, res: any) => {
    try {
      const [rows] = await pool.query('SELECT * FROM site_settings WHERE id = 1');
      const settings = (rows as any[])[0] || {};
      res.json({
        name: settings.name,
        logo: settings.logo,
        loginTitle: settings.loginTitle,
        loginSubtitle: settings.loginSubtitle,
        loginTagline1: settings.loginTagline1,
        loginTagline2: settings.loginTagline2,
        requestsTitle: settings.requestsTitle,
        requestsSubtitle: settings.requestsSubtitle,
        darkMode: settings.darkMode === 1
      });
    } catch (error) {
      console.error('Error fetching settings:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.put('/api/settings', isAdmin, async (req: any, res: any) => {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ error: 'Forbidden: Super Admin only' });
    }
    let { name, logo, loginTitle, loginSubtitle, loginTagline1, loginTagline2, requestsTitle, requestsSubtitle, darkMode } = req.body;

    try {
      if (logo && logo.startsWith('data:image/')) {
        const matches = logo.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          let imageType = matches[1];
          let base64Data = matches[2];
          let buffer: any = Buffer.from(base64Data, 'base64');
          let filename = `logo-${Date.now()}`;

          const PUBLIC_UPLOAD_DIR = path.join(process.cwd(), 'public_uploads', 'logos');
          if (!fs.existsSync(PUBLIC_UPLOAD_DIR)) {
            fs.mkdirSync(PUBLIC_UPLOAD_DIR, { recursive: true });
          }

          if (imageType.includes('svg')) {
            filename += '.svg';
          } else if (imageType.includes('png')) {
            filename += '.png';
          } else if (imageType.includes('jpeg') || imageType.includes('jpg')) {
            filename += '.jpg';
          } else if (imageType.includes('bmp')) {
            filename += '.bmp';
          } else if (imageType.includes('x-icon') || imageType.includes('vnd.microsoft.icon')) {
            filename += '.ico';
          } else {
            filename += '.bin'; // Fallback
          }

          await fs.promises.writeFile(path.join(PUBLIC_UPLOAD_DIR, filename), buffer);
          logo = `/public_uploads/logos/${filename}`;
        }
      }

      await pool.query(`
        UPDATE site_settings 
        SET name = ?, logo = ?, loginTitle = ?, loginSubtitle = ?, loginTagline1 = ?, loginTagline2 = ?, requestsTitle = ?, requestsSubtitle = ?, darkMode = ?
        WHERE id = 1
      `, [name, logo, loginTitle, loginSubtitle, loginTagline1, loginTagline2, requestsTitle, requestsSubtitle, darkMode ? 1 : 0]);
      res.json({ success: true, updatedLogo: logo });
    } catch (error) {
      console.error('Error updating settings:', error);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  app.put('/api/profile', isAdmin, async (req: any, res: any) => {
    try {
      let { nama, pangkat, nrp, jabatan, telepon, email, foto } = req.body;

      if (!nama || typeof nama !== 'string' || !nama.trim()) {
        return res.status(400).json({ success: false, message: 'Nama lengkap wajib diisi' });
      }

      const safeNama = nama.trim().slice(0, 255);
      const safePangkat = typeof pangkat === 'string' ? pangkat.trim().slice(0, 100) : '';
      const safeJabatan = typeof jabatan === 'string' ? jabatan.trim().slice(0, 255) : '';
      const safeTelepon = typeof telepon === 'string' ? telepon.trim().slice(0, 50) : '';
      const safeEmail = typeof email === 'string' ? email.trim().slice(0, 255) : '';
      let safeFoto = typeof foto === 'string' ? foto : null;

      // Handle image file write if data URL is provided
      if (safeFoto && safeFoto.startsWith('data:image/')) {
        const matches = safeFoto.match(/^data:image\/([A-Za-z-+\/]+);base64,(.+)$/);
        if (matches && matches.length === 3) {
          const imageType = matches[1];
          const base64Data = matches[2];
          const buffer = Buffer.from(base64Data, 'base64');
          let ext = '.png';
          if (imageType.includes('jpeg') || imageType.includes('jpg')) ext = '.jpg';
          else if (imageType.includes('webp')) ext = '.webp';
          else if (imageType.includes('svg')) ext = '.svg';

          const PROFILE_UPLOAD_DIR = path.join(process.cwd(), 'public_uploads', 'profiles');
          if (!fs.existsSync(PROFILE_UPLOAD_DIR)) {
            fs.mkdirSync(PROFILE_UPLOAD_DIR, { recursive: true });
          }

          const filename = `profile-${req.user.id}-${Date.now()}${ext}`;
          await fs.promises.writeFile(path.join(PROFILE_UPLOAD_DIR, filename), buffer);
          safeFoto = `/public_uploads/profiles/${filename}`;
        }
      } else if (safeFoto && safeFoto.length > 255) {
        // Enforce VARCHAR(255) constraint and prevent direct base64 injection into database
        safeFoto = null;
      }

      // Check NRP uniqueness if NRP is being changed
      if (nrp && typeof nrp === 'string' && nrp.trim() && nrp.trim() !== req.user.nrp) {
        const cleanNrp = nrp.trim();
        const [existing]: any = await pool.query(
          'SELECT id FROM personnel WHERE nrp = ? AND id != ? AND is_deleted = 0',
          [cleanNrp, req.user.id]
        );
        if (existing.length > 0) {
          return res.status(400).json({ success: false, message: 'NRP / NIP sudah digunakan oleh personel lain' });
        }
        await pool.query('UPDATE personnel SET nrp = ? WHERE id = ?', [cleanNrp, req.user.id]);
      }

      // Update user details in personnel table
      await pool.query(`
        UPDATE personnel 
        SET nama = ?, pangkat = ?, jabatan = ?, telepon = ?, email = ?, foto = ?
        WHERE id = ? AND is_deleted = 0
      `, [safeNama, safePangkat, safeJabatan, safeTelepon, safeEmail, safeFoto, req.user.id]);

      // Fetch the updated user record
      const [updatedRows]: any = await pool.query(`
        SELECT id, nama, pangkat, nrp, jabatan, kesatuan, email, role, status, telepon, foto, lastLogin, must_change_password
        FROM personnel 
        WHERE id = ? AND is_deleted = 0
      `, [req.user.id]);

      if (updatedRows.length === 0) {
        return res.status(404).json({ success: false, message: 'Pengguna tidak ditemukan' });
      }

      const updatedUser = updatedRows[0];

      // Refresh JWT Token with updated user info
      const token = jwt.sign(updatedUser, JWT_SECRET, { expiresIn: '24h' });
      res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000
      });

      res.json({
        success: true,
        message: 'Profil berhasil diperbarui',
        user: updatedUser
      });
    } catch (error) {
      console.error('Failed to update profile:', error);
      res.status(500).json({ success: false, message: 'Terjadi kesalahan saat memperbarui profil' });
    }
  });

  app.post('/api/change-password', isAdmin, changePasswordLimiter, async (req: any, res: any) => {
    try {
      const { currentPassword, newPassword, confirmPassword } = req.body;

      if (!currentPassword || !newPassword || !confirmPassword) {
        return res.status(400).json({ success: false, message: 'Semua bidang password wajib diisi' });
      }

      if (newPassword !== confirmPassword) {
        return res.status(400).json({ success: false, message: 'Konfirmasi password baru tidak cocok' });
      }

      // Password complexity check
      const hasNumber = /\d/.test(newPassword);
      const hasSymbol = /[!@#$%^&*(),.?":{}|<>]/.test(newPassword);
      const hasUpper = /[A-Z]/.test(newPassword);
      if (newPassword.length < 8 || !hasNumber || !hasSymbol || !hasUpper) {
        return res.status(400).json({
          success: false,
          message: 'Password baru harus minimal 8 karakter, mengandung huruf besar, angka, dan simbol'
        });
      }

      // Fetch current password hash from database
      const [userRows]: any = await pool.query(
        'SELECT id, password FROM personnel WHERE id = ? AND is_deleted = 0',
        [req.user.id]
      );

      if (userRows.length === 0) {
        return res.status(404).json({ success: false, message: 'Pengguna tidak ditemukan' });
      }

      const dbUser = userRows[0];

      // Verify current password with bcrypt
      const isMatch = await bcrypt.compare(currentPassword, dbUser.password);
      if (!isMatch) {
        return res.status(400).json({ success: false, message: 'Password saat ini tidak valid' });
      }

      // Hash new password
      const saltRounds = 10;
      const hashedPassword = await bcrypt.hash(newPassword, saltRounds);

      // Update in database and reset must_change_password flag
      await pool.query(
        'UPDATE personnel SET password = ?, password_encrypted = ?, must_change_password = 0 WHERE id = ?',
        [hashedPassword, encryptResetPassword(newPassword), req.user.id]
      );

      res.json({
        success: true,
        message: 'Password berhasil diperbarui'
      });
    } catch (error) {
      console.error('Failed to change password:', error);
      res.status(500).json({ success: false, message: 'Terjadi kesalahan saat mengubah password' });
    }
  });

  app.get('/api/stats', isAdmin, async (req: any, res: any) => {
    try {
      let roleConditionPer = 'WHERE is_deleted = 0';
      let roleConditionReq = 'WHERE is_deleted = 0';
      let paramsPer: any[] = [];
      let paramsReq: any[] = [];

      // If user is 'user' role (Operator Polres/Polsek), filter by their kesatuan
      if (req.user.role === 'user') {
        roleConditionPer += ' AND kesatuan = TRIM(?)';
        roleConditionReq += ' AND kesatuan = TRIM(?)';
        paramsPer.push(req.user.kesatuan || '');
        paramsReq.push(req.user.kesatuan || '');
      }

      // Single efficient query for all request metrics
      const [reqStatsRows]: any = await pool.query(
        `SELECT 
          COUNT(*) as total,
          COUNT(CASE WHEN status = 'MENUNGGU' THEN 1 END) as pending,
          COUNT(CASE WHEN status = 'DIPROSES' THEN 1 END) as processing,
          COUNT(CASE WHEN status = 'SELESAI' THEN 1 END) as completed,
          COUNT(CASE WHEN status = 'DITOLAK' THEN 1 END) as rejected,
          COUNT(CASE WHEN prioritas = 'Mendesak' AND status != 'SELESAI' AND status != 'DITOLAK' THEN 1 END) as urgent,
          COUNT(CASE WHEN status != 'SELESAI' AND status != 'DITOLAK' THEN 1 END) as active
        FROM reset_requests ${roleConditionReq}`,
        paramsReq
      );

      const rStats = reqStatsRows[0] || { total: 0, pending: 0, processing: 0, completed: 0, rejected: 0, urgent: 0, active: 0 };

      // Personnel total
      const [perStatsRows]: any = await pool.query(
        `SELECT COUNT(*) as total FROM personnel ${roleConditionPer}`,
        paramsPer
      );
      const pStats = perStatsRows[0] || { total: 0 };

      // Fetch recent 5 requests for Dashboard
      const [recentRows]: any = await pool.query(
        `SELECT id, nama, pangkat, nrp, jabatan, kesatuan, status, prioritas, createdAt
        FROM reset_requests ${roleConditionReq}
        ORDER BY createdAt DESC
        LIMIT 5`,
        paramsReq
      );

      // Fetch timestamps from last 30 days for activity chart
      const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
      const [chartTimestamps]: any = await pool.query(
        `SELECT createdAt FROM reset_requests ${roleConditionReq} AND createdAt >= ?`,
        [...paramsReq, thirtyDaysAgo]
      );

      // Generate 7-day and 30-day buckets
      const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
      const buildChartData = (daysCount: number) => {
        const days = Array.from({ length: daysCount }, (_, i) => {
          const d = new Date();
          d.setDate(d.getDate() - (daysCount - 1 - i));
          return d;
        });

        return days.map(date => {
          const dayStart = new Date(date).setHours(0, 0, 0, 0);
          const dayEnd = new Date(date).setHours(23, 59, 59, 999);
          const count = chartTimestamps.filter((row: any) => {
            const time = Number(row.createdAt) || 0;
            return time >= dayStart && time <= dayEnd;
          }).length;

          return {
            name: daysCount > 7
              ? date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })
              : dayNames[date.getDay()],
            permintaan: count,
            fullDate: date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
          };
        });
      };

      const chart7d = buildChartData(7);
      const chart30d = buildChartData(30);

      res.json({
        success: true,
        requests: {
          total: Number(rStats.total) || 0,
          pending: Number(rStats.pending) || 0,
          processing: Number(rStats.processing) || 0,
          completed: Number(rStats.completed) || 0,
          rejected: Number(rStats.rejected) || 0,
          urgent: Number(rStats.urgent) || 0,
          active: Number(rStats.active) || 0
        },
        personnel: {
          total: Number(pStats.total) || 0
        },
        chart7d,
        chart30d,
        recentRequests: recentRows.map((r: any) => ({
          ...r,
          createdAt: Number(r.createdAt) || 0
        }))
      });
    } catch (e) {
      console.error('/api/stats error:', e);
      res.status(500).json({ success: false, message: 'Gagal mengambil data statistik' });
    }
  });

  // Dedicated high-performance aggregation endpoint for Reports (Fase 4 Optimization)
  app.get('/api/reports/summary', isAdmin, async (req: any, res: any) => {
    try {
      const { startDate, endDate, kesatuan } = req.query;

      let whereClauses: string[] = ['is_deleted = 0'];
      let params: any[] = [];

      // Role-based kesatuan restriction: 'user' can only access their own kesatuan
      if (req.user.role === 'user') {
        whereClauses.push('kesatuan = TRIM(?)');
        params.push(String(req.user.kesatuan || '').trim());
      } else if (kesatuan && kesatuan !== 'ALL' && typeof kesatuan === 'string') {
        whereClauses.push('kesatuan = TRIM(?)');
        params.push(kesatuan.trim());
      }

      // Date filtering using millisecond timestamps
      if (startDate && typeof startDate === 'string') {
        const startMs = new Date(`${startDate}T00:00:00`).getTime();
        if (!isNaN(startMs)) {
          whereClauses.push('createdAt >= ?');
          params.push(startMs);
        }
      }
      if (endDate && typeof endDate === 'string') {
        const endMs = new Date(`${endDate}T23:59:59.999`).getTime();
        if (!isNaN(endMs)) {
          whereClauses.push('createdAt <= ?');
          params.push(endMs);
        }
      }

      const whereSql = 'WHERE ' + whereClauses.join(' AND ');

      // 1. Status distribution & overall totals
      const [distRows]: any = await pool.query(
        `SELECT 
          COUNT(*) as total,
          COALESCE(SUM(CASE WHEN status = 'SELESAI' THEN 1 ELSE 0 END), 0) as selesai,
          COALESCE(SUM(CASE WHEN status = 'DITOLAK' THEN 1 ELSE 0 END), 0) as ditolak,
          COALESCE(SUM(CASE WHEN status NOT IN ('SELESAI', 'DITOLAK') THEN 1 ELSE 0 END), 0) as pending
        FROM reset_requests ${whereSql}`,
        params
      );

      const d = distRows[0] || { total: 0, selesai: 0, ditolak: 0, pending: 0 };
      const total = Number(d.total) || 0;
      const finished = Number(d.selesai) || 0;
      const rejected = Number(d.ditolak) || 0;
      const pending = Number(d.pending) || 0;

      const finishedPercent = total > 0 ? Math.round((finished / total) * 100) : 0;
      const rejectedPercent = total > 0 ? Math.round((rejected / total) * 100) : 0;
      const pendingPercent = total > 0 ? Math.round((pending / total) * 100) : 0;

      const pieData = {
        chart: [
          { name: `Selesai (${finishedPercent}%)`, value: finished, color: '#10b981' },
          { name: `Ditolak (${rejectedPercent}%)`, value: rejected, color: '#ef4444' },
          { name: `Proses (${pendingPercent}%)`, value: pending, color: '#f59e0b' }
        ],
        total,
        finished,
        rejected,
        pending
      };

      // 2. Trend by day of week (Monday to Sunday)
      const [dowRows]: any = await pool.query(
        `SELECT 
          WEEKDAY(FROM_UNIXTIME(createdAt / 1000)) as wd,
          COUNT(*) as count
        FROM reset_requests ${whereSql}
        GROUP BY wd`,
        params
      );

      const dayNames = ['SEN', 'SEL', 'RAB', 'KAM', 'JUM', 'SAB', 'MIN'];
      const dowMap: Record<number, number> = {};
      for (const row of dowRows) {
        dowMap[Number(row.wd)] = Number(row.count) || 0;
      }
      const barData = dayNames.map((name, idx) => ({
        name,
        permintaan: dowMap[idx] || 0
      }));

      // 3. Summary per kesatuan / polres
      const [polresRows]: any = await pool.query(
        `SELECT 
          COALESCE(NULLIF(TRIM(kesatuan), ''), 'Lainnya') as name,
          COUNT(*) as total,
          COALESCE(SUM(CASE WHEN status NOT IN ('SELESAI', 'DITOLAK') THEN 1 ELSE 0 END), 0) as backlog,
          COALESCE(SUM(CASE WHEN status = 'SELESAI' THEN 1 ELSE 0 END), 0) as selesai,
          COALESCE(SUM(CASE WHEN status = 'DITOLAK' THEN 1 ELSE 0 END), 0) as ditolak
        FROM reset_requests ${whereSql}
        GROUP BY name
        ORDER BY total DESC, name ASC`,
        params
      );

      const polresSummary = polresRows.map((item: any) => {
        const itemTotal = Number(item.total) || 0;
        const itemSelesai = Number(item.selesai) || 0;
        return {
          name: item.name,
          total: itemTotal,
          backlog: Number(item.backlog) || 0,
          selesai: itemSelesai,
          ditolak: Number(item.ditolak) || 0,
          ratio: itemTotal > 0 ? ((itemSelesai / itemTotal) * 100).toFixed(1) : "0",
          repeat: "2.4",
          avg: "1.2"
        };
      });

      res.json({
        success: true,
        total,
        pieData,
        barData,
        polresSummary
      });
    } catch (e) {
      console.error('/api/reports/summary error:', e);
      res.status(500).json({ success: false, message: 'Gagal memproses rekapitulasi laporan' });
    }
  });

  app.get('/api/personnel', isAdmin, async (req: any, res: any) => {
    const page = parseInt(req.query.page || '1');
    const limit = req.query.limit === 'all' ? 10000 : Math.min(parseInt(req.query.limit || '10') || 10, 10000);
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const role = req.query.role;
    const kesatuan = req.query.kesatuan;

    let query = 'SELECT id, nama, pangkat, nrp, jabatan, kesatuan, email, role, status, telepon, is_deleted, lastLogin, must_change_password, password_encrypted FROM personnel';
    let countQuery = 'SELECT COUNT(*) as count FROM personnel';
    let params: any[] = [];
    let whereClauses: string[] = ['is_deleted = 0'];

    // Role-based filtering: 'user' role is strictly restricted to their own kesatuan
    // 'admin' and 'superadmin' can see all personnel
    if (req.user.role === 'user') {
      whereClauses.push('kesatuan = ?');
      params.push(String(req.user.kesatuan || '').trim());
    }

    if (search) {
      whereClauses.push('(nama LIKE ? OR nrp LIKE ? OR kesatuan LIKE ?)');
      const s = `%${search}%`;
      params.push(s, s, s);
    }
    if (role && role !== 'ALL') {
      whereClauses.push('role = ?');
      params.push(role);
    }
    if (kesatuan && kesatuan !== 'ALL') {
      whereClauses.push('kesatuan = ?');
      params.push(kesatuan);
    }

    if (whereClauses.length > 0) {
      const whereStr = ' WHERE ' + whereClauses.join(' AND ');
      query += whereStr;
      countQuery += whereStr;
    }

    query += ' ORDER BY nama ASC LIMIT ? OFFSET ?';
    const countParams = [...params];
    params.push(limit, offset);

    const [rows]: any = await pool.query(query, params);
    const [totalRows]: any = await pool.query(countQuery, countParams);

    // Compute summary across personnel for stats badges (Fase 6.3)
    let summaryWhere = ['is_deleted = 0'];
    let summaryParams: any[] = [];
    if (req.user.role === 'user') {
      summaryWhere.push('kesatuan = ?');
      summaryParams.push(String(req.user.kesatuan || '').trim());
    } else if (kesatuan && kesatuan !== 'ALL') {
      summaryWhere.push('kesatuan = ?');
      summaryParams.push(kesatuan);
    }

    const [summaryRows]: any = await pool.query(`
      SELECT 
        COUNT(*) as total,
        COALESCE(SUM(CASE WHEN role = 'superadmin' THEN 1 ELSE 0 END), 0) as superAdmin,
        COALESCE(SUM(CASE WHEN role = 'admin' THEN 1 ELSE 0 END), 0) as admin,
        COALESCE(SUM(CASE WHEN role = 'user' THEN 1 ELSE 0 END), 0) as user,
        COALESCE(SUM(CASE WHEN status = 'Aktif' THEN 1 ELSE 0 END), 0) as active
      FROM personnel
      WHERE ${summaryWhere.join(' AND ')}
    `, summaryParams);

    const sRow = summaryRows[0] || {};
    const totalCount = totalRows[0]?.count ?? 0;
    const summary = {
      total: Number(sRow.total || 0),
      superAdmin: Number(sRow.superAdmin || 0),
      admin: Number(sRow.admin || 0),
      user: Number(sRow.user || 0),
      active: Number(sRow.active || 0)
    };

    // Explicitly sanitize rows. Only SuperAdmin can see decrypted password.
    const sanitizedRows = rows.map((r: any) => {
      const { password, password_encrypted, ...safeUser } = r;
      if (req.user && req.user.role === 'superadmin') {
        const decrypted = password_encrypted ? decryptResetPassword(password_encrypted) : null;
        return {
          ...safeUser,
          password: decrypted || (r.role === 'superadmin' ? (r.id === 'SA1' ? 'superadmin123' : r.id === 'SA2' ? 'siperadmin123' : 'PasswordDemo123!') : 'PasswordDemo123!')
        };
      }
      return safeUser;
    });

    res.json({
      data: sanitizedRows,
      total: totalCount,
      count: totalCount,
      summary,
      page,
      limit
    });
  });

  // Dedicated lightweight endpoint to fetch personnel photo on-demand (Fase 3 Optimization)
  app.get('/api/personnel/:id/foto', isAdmin, async (req: any, res: any) => {
    try {
      const { id } = req.params;
      const [rows]: any = await pool.query(
        'SELECT id, nama, foto FROM personnel WHERE id = ? AND is_deleted = 0',
        [id]
      );
      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Personel tidak ditemukan' });
      }
      res.json({ success: true, foto: rows[0].foto || null });
    } catch (error) {
      console.error('Error fetching personnel photo:', error);
      res.status(500).json({ success: false, message: 'Gagal memuat foto personel' });
    }
  });

  // Dedicated endpoint to fetch single personnel details (including foto) on-demand
  app.get('/api/personnel/:id', isAdmin, async (req: any, res: any) => {
    try {
      const { id } = req.params;
      const [rows]: any = await pool.query(
        'SELECT id, nama, pangkat, nrp, jabatan, kesatuan, email, role, status, telepon, foto, is_deleted, lastLogin, must_change_password, password_encrypted FROM personnel WHERE id = ? AND is_deleted = 0',
        [id]
      );
      if (rows.length === 0) {
        return res.status(404).json({ success: false, message: 'Personel tidak ditemukan' });
      }
      const { password, password_encrypted, ...safeUser } = rows[0];
      if (req.user && req.user.role === 'superadmin') {
        const decrypted = password_encrypted ? decryptResetPassword(password_encrypted) : null;
        safeUser.password = decrypted || (rows[0].role === 'superadmin' ? (rows[0].id === 'SA1' ? 'superadmin123' : rows[0].id === 'SA2' ? 'siperadmin123' : 'PasswordDemo123!') : 'PasswordDemo123!');
      }
      res.json({ success: true, data: safeUser });
    } catch (error) {
      console.error('Error fetching single personnel details:', error);
      res.status(500).json({ success: false, message: 'Gagal memuat detail personel' });
    }
  });

  app.post('/api/personnel/import', isSuperAdmin, importLimiter, async (req: any, res: any) => {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ success: false, message: 'Akses ditolak. Hanya SUPERADMIN yang diizinkan mengimpor data personel.' });
    }

    try {
      const personnelData = req.body;
      if (!Array.isArray(personnelData)) return res.status(400).json({ success: false, message: 'Data harus berupa array' });

      if (personnelData.length === 0) return res.json({ success: true, imported: 0 });

      // Build bulk insert query
      const values: any[] = [];
      const placeholders = [];
      for (const p of personnelData) {
        const rawPass = p.passwordPlain || 'PasswordDemo123!';
        const hashedPassword = await bcrypt.hash(rawPass, 10);
        const encryptedPassword = encryptResetPassword(rawPass);
        const finalKesatuan = String(p.kesatuan || '').trim();
        values.push(p.id, p.nama, p.pangkat, p.nrp, p.jabatan, finalKesatuan, p.email, p.role || 'user', hashedPassword, encryptedPassword, p.status || 'Aktif');
        placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      }

      await pool.query(
        `INSERT IGNORE INTO personnel (id, nama, pangkat, nrp, jabatan, kesatuan, email, role, password, password_encrypted, status) VALUES ${placeholders.join(', ')}`,
        values
      );
      res.json({ success: true, imported: personnelData.length });
    } catch (e: any) {
      console.error('Bulk import error:', e);
      res.status(500).json({ success: false, message: 'Gagal melakukan import massal ke server' });
    }
  });

  app.post('/api/personnel', isSuperAdmin, async (req: any, res: any) => {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ success: false, message: 'Akses ditolak. Hanya SUPERADMIN yang diizinkan menambah data personel.' });
    }
    const p = req.body;
    const rawPass = p.password || (p.role === 'superadmin' ? 'superadmin!123' : p.role === 'admin' ? 'admin!1234' : 'user!1234');
    const hashedPassword = await bcrypt.hash(rawPass, 10);
    const encryptedPassword = encryptResetPassword(rawPass);
    const finalKesatuan = (p.kesatuan && String(p.kesatuan).trim()) ? String(p.kesatuan).trim() : null;

    try {
      await pool.query(`
        INSERT INTO personnel (id, nama, pangkat, nrp, jabatan, kesatuan, email, role, password, password_encrypted, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [p.id, p.nama, p.pangkat, p.nrp, p.jabatan, finalKesatuan, p.email, p.role, hashedPassword, encryptedPassword, p.status || 'Aktif']);
      res.json({ success: true });
    } catch (error: any) {
      console.error('Failed to create personnel:', error);
      if (error.code === 'ER_NO_REFERENCED_ROW_2') {
        return res.status(400).json({
          success: false,
          message: `Kesatuan '${p.kesatuan}' tidak terdaftar dalam referensi unit resmi Polda Jatim. Silakan pilih kesatuan yang valid.`
        });
      }
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({
          success: false,
          message: `Peringatan: NRP/NIP ${p.nrp} sudah terdaftar di dalam sistem! Silakan gunakan NRP lain atau periksa kembali data personel.`,
          code: 'DUPLICATE_NRP'
        });
      }
      res.status(500).json({ success: false, message: 'Gagal menyimpan data ke server' });
    }
  });

  app.put('/api/personnel/:id', isSuperAdmin, async (req: any, res: any) => {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ success: false, message: 'Akses ditolak. Hanya SUPERADMIN yang diizinkan memperbarui data personel.' });
    }
    const { id } = req.params;
    const p = req.body;
    const finalKesatuan = (p.kesatuan && String(p.kesatuan).trim()) ? String(p.kesatuan).trim() : null;

    try {
      if (p.password) {
        const hashedPassword = await bcrypt.hash(p.password, 10);
        const encryptedPassword = encryptResetPassword(p.password);
        await pool.query(`
          UPDATE personnel 
          SET nama = ?, pangkat = ?, nrp = ?, jabatan = ?, kesatuan = ?, email = ?, role = ?, status = ?, password = ?, password_encrypted = ?
          WHERE id = ?
        `, [p.nama, p.pangkat, p.nrp, p.jabatan, finalKesatuan, p.email, p.role, p.status, hashedPassword, encryptedPassword, id]);
      } else {
        await pool.query(`
          UPDATE personnel 
          SET nama = ?, pangkat = ?, nrp = ?, jabatan = ?, kesatuan = ?, email = ?, role = ?, status = ?
          WHERE id = ?
        `, [p.nama, p.pangkat, p.nrp, p.jabatan, finalKesatuan, p.email, p.role, p.status, id]);
      }
      res.json({ success: true });
    } catch (error: any) {
      console.error('Failed to update personnel:', error);
      if (error.code === 'ER_NO_REFERENCED_ROW_2') {
        return res.status(400).json({
          success: false,
          message: `Kesatuan '${p.kesatuan}' tidak terdaftar dalam referensi unit resmi Polda Jatim. Silakan pilih kesatuan yang valid.`
        });
      }
      if (error.code === 'ER_DUP_ENTRY') {
        return res.status(409).json({
          success: false,
          message: `Peringatan: NRP/NIP ${p.nrp} sudah terdaftar di dalam sistem! Silakan gunakan NRP lain atau periksa kembali data personel.`,
          code: 'DUPLICATE_NRP'
        });
      }
      res.status(500).json({ success: false, message: 'Gagal memperbarui data personel' });
    }
  });

  app.delete('/api/personnel/:id', isSuperAdmin, async (req: any, res: any) => {
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ success: false, message: 'Akses ditolak. Hanya SUPERADMIN yang diizinkan menghapus data personel.' });
    }
    const { id } = req.params;
    await pool.query('UPDATE personnel SET is_deleted = 1 WHERE id = ?', [id]);
    res.json({ success: true });
  });

  app.post('/api/login', loginIpLimiter, loginAccountLimiter, async (req: any, res: any) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Email dan Password wajib diisi' });
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanPassword = password.trim();

    try {
      const [rows]: any = await pool.query(
        'SELECT * FROM personnel WHERE email = ? AND is_deleted = 0',
        [cleanEmail]
      );

      if (rows.length > 0) {
        const user = rows[0];
        const isMatch = await bcrypt.compare(cleanPassword, user.password);

        if (isMatch) {
          // Invalidate previous unused OTPs for this user's NRP
          await pool.query('UPDATE otp_codes SET isUsed = 1 WHERE nrp = ? AND isUsed = 0', [user.nrp]);

          // Fase 9.2: Generate Cryptographically Secure 6-digit numeric OTP (100000 - 999999)
          const otpCode = crypto.randomInt(100000, 1000000).toString();

          // Fase 9.2: Compute one-way SHA-256 cryptographic digest of the OTP
          const codeHash = crypto.createHash('sha256').update(otpCode).digest('hex');

          // Fase 9.4: Issue temporary signed JWT (tempToken) for 5 minutes (MFA pending stage)
          const tempToken = jwt.sign(
            { userId: user.id, nrp: user.nrp, stage: 'mfa_pending' },
            JWT_SECRET,
            { expiresIn: '5m' }
          );

          const expiresAt = Date.now() + (5 * 60 * 1000); // 5 minutes TTL
          const expiryTimeStr = new Date(expiresAt).toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
          }).replace(/\./g, ':');

          // Fase 9.1 & 9.2: Save code_hash and tempToken to database (zero plaintext OTP in MySQL)
          await pool.query(
            'INSERT INTO otp_codes (nrp, code_hash, expiresAt, token, isUsed, attempts) VALUES (?, ?, ?, ?, 0, 0)',
            [user.nrp, codeHash, expiresAt, tempToken]
          );

          // Attempt to send email
          try {
            if (user.email) {
              const mailOptions = {
                from: process.env.SMTP_USER || 'your-email@polda-jatim.go.id',
                to: user.email,
                subject: 'Kode OTP Login Sistem Reset Password',
                text: `Halo ${user.nama},\n\nKode OTP Anda untuk login adalah: ${otpCode}\n\nKode ini berlaku selama 5 menit (sampai jam ${expiryTimeStr} WIB).\n\nJika Anda tidak merasa melakukan login, segera hubungi Administrator.`
              };
              await transporter.sendMail(mailOptions);
              console.log(`[MFA LOGIN] Kode OTP untuk ${user.nrp} berhasil dikirim ke ${user.email} (Kode: ${otpCode}) | Berlaku selama 5 menit (sampai jam ${expiryTimeStr} WIB)`);
            } else {
              console.log(`[SIMULASI MFA LOGIN] Kode OTP untuk ${user.nrp} adalah: ${otpCode} (User tidak memiliki email) | Berlaku selama 5 menit (sampai jam ${expiryTimeStr} WIB)`);
            }
          } catch (emailError) {
            console.error('Failed to send MFA OTP email:', emailError);
            console.log(`[SIMULASI MFA LOGIN] Kode OTP untuk ${user.nrp} adalah: ${otpCode} (Email gagal dikirim) | Berlaku selama 5 menit (sampai jam ${expiryTimeStr} WIB)`);
          }

          // Fase 9.4: Return response asking for MFA, including tempToken (Sequence Diagram Fig 3.10)
          res.json({
            success: true,
            mfa_required: true,
            identifier: user.nrp,
            tempToken,
            message: 'Kredensial benar. Silakan masukkan kode OTP yang dikirim ke email Anda.'
          });
        } else {
          res.status(401).json({ success: false, message: 'Email atau Password salah' });
        }
      } else {
        res.status(401).json({ success: false, message: 'Email atau Password salah' });
      }
    } catch (error) {
      console.error('[LOGIN] Database error:', error);
      res.status(500).json({ success: false, message: 'Terjadi kesalahan pada server' });
    }
  });

  // --- Verified & Hardened Endpoint: Verify MFA for Login ---
  app.post('/api/login/verify-mfa', mfaVerifyLimiter, async (req: any, res: any) => {
    const { identifier, code, tempToken } = req.body;

    if (!code) {
      return res.status(400).json({ success: false, message: 'Kode OTP wajib diisi' });
    }

    const cleanCode = String(code).trim();

    // Fase 9.4: Validate tempToken if provided (Sequence Diagram Fig 3.10)
    let verifiedNrp = identifier ? String(identifier).trim() : '';
    if (tempToken) {
      try {
        const decodedTemp: any = jwt.verify(tempToken, JWT_SECRET);
        if (decodedTemp.stage !== 'mfa_pending') {
          return res.status(401).json({ success: false, message: 'Token sementara tidak valid untuk verifikasi MFA.' });
        }
        verifiedNrp = decodedTemp.nrp;
      } catch (jwtErr: any) {
        return res.status(401).json({
          success: false,
          message: 'Sesi token sementara telah kedaluwarsa atau tidak valid (5 menit). Silakan login kembali.'
        });
      }
    }

    if (!verifiedNrp) {
      return res.status(400).json({ success: false, message: 'Identifier atau Token Sementara wajib disertakan.' });
    }

    try {
      // Check latest active OTP for this identifier
      const [otpRows]: any = await pool.query(
        'SELECT * FROM otp_codes WHERE nrp = ? AND isUsed = 0 AND expiresAt > ? ORDER BY id DESC LIMIT 1',
        [verifiedNrp, Date.now()]
      );

      if (otpRows.length === 0) {
        return res.status(401).json({
          success: false,
          message: 'Kode OTP tidak ditemukan atau sudah kedaluwarsa (berlaku 5 menit). Silakan login kembali.'
        });
      }

      const activeOtp = otpRows[0];

      // Anti-Brute-Force: Check attempts count (Max 5 attempts allowed per OTP)
      if (activeOtp.attempts >= 5) {
        await pool.query('UPDATE otp_codes SET isUsed = 1 WHERE id = ?', [activeOtp.id]);
        return res.status(401).json({
          success: false,
          message: 'Batas percobaan salah telah terlampaui (maks 5 kali). Kode OTP ini dibatalkan demi keamanan. Silakan login kembali.'
        });
      }

      // Fase 9.3: Compute SHA-256 hash of the input code
      const inputHash = crypto.createHash('sha256').update(cleanCode).digest('hex');

      // Fase 9.3: Constant-time comparison between stored code_hash and inputHash
      let isCodeMatch = false;
      if (activeOtp.code_hash && typeof activeOtp.code_hash === 'string' && activeOtp.code_hash.length === 64) {
        try {
          isCodeMatch = crypto.timingSafeEqual(
            Buffer.from(activeOtp.code_hash, 'utf8'),
            Buffer.from(inputHash, 'utf8')
          );
        } catch (cmpErr) {
          isCodeMatch = false;
        }
      } else if (activeOtp.code) {
        // Fallback for legacy unmigrated plaintext OTPs if any
        isCodeMatch = activeOtp.code === cleanCode;
      }

      if (!isCodeMatch) {
        const newAttempts = Number(activeOtp.attempts || 0) + 1;
        const remaining = 5 - newAttempts;

        if (remaining <= 0) {
          await pool.query('UPDATE otp_codes SET isUsed = 1, attempts = ? WHERE id = ?', [newAttempts, activeOtp.id]);
          return res.status(401).json({
            success: false,
            message: 'Kode OTP salah. Batas percobaan habis. Silakan login kembali untuk mendapatkan kode baru.'
          });
        } else {
          await pool.query('UPDATE otp_codes SET attempts = ? WHERE id = ?', [newAttempts, activeOtp.id]);
          return res.status(401).json({
            success: false,
            message: `Kode OTP salah. Sisa kesempatan: ${remaining} kali.`
          });
        }
      }

      // OTP is valid! Mark as used
      await pool.query('UPDATE otp_codes SET isUsed = 1 WHERE id = ?', [activeOtp.id]);

      // Get user data to issue JWT
      const [userRows]: any = await pool.query('SELECT * FROM personnel WHERE nrp = ? AND is_deleted = 0', [verifiedNrp]);
      if (userRows.length === 0) {
        return res.status(404).json({ success: false, message: 'Data pengguna tidak ditemukan atau akun telah dinonaktifkan' });
      }

      const user = userRows[0];
      const { password: _, ...userWithoutPassword } = user;

      // Update lastLogin
      await pool.query('UPDATE personnel SET lastLogin = ? WHERE id = ?', [Date.now(), user.id]);

      // Record login audit log directly in backend (Fase 6.1)
      try {
        const rawIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '127.0.0.1';
        let clientIp = '127.0.0.1';
        if (typeof rawIp === 'string' && rawIp.trim()) {
          clientIp = rawIp.split(',')[0].trim();
        } else if (Array.isArray(rawIp) && rawIp.length > 0) {
          clientIp = rawIp[0].trim();
        }
        if (clientIp.startsWith('::ffff:')) {
          clientIp = clientIp.replace('::ffff:', '');
        }

        const logId = `L-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
        const logWaktu = Date.now();
        await pool.query(`
          INSERT INTO logs (id, waktu, user_nama, user_role, aktivitas, keterangan, ipAddress)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `, [
          logId,
          logWaktu,
          user.nama,
          user.role,
          'Login',
          `Pengguna ${user.nama} berhasil masuk ke sistem dengan MFA`,
          clientIp
        ]);
      } catch (logErr) {
        console.error('[MFA VERIFY] Failed to record login audit log:', logErr);
      }

      // Create JWT Token
      const token = jwt.sign(userWithoutPassword, JWT_SECRET, { expiresIn: '24h' });

      // Set HttpOnly Cookie
      res.cookie('token', token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax',
        maxAge: 24 * 60 * 60 * 1000 // 24 hours
      });

      res.json({ success: true, user: userWithoutPassword });
    } catch (error) {
      console.error('[MFA VERIFY] Database error:', error);
      res.status(500).json({ success: false, message: 'Terjadi kesalahan saat verifikasi OTP' });
    }
  });

  app.post('/api/logout', (req: any, res: any) => {
    res.clearCookie('token');
    res.json({ success: true });
  });

  app.get('/api/me', (req: any, res: any) => {
    const token = req.cookies.token;
    if (!token) {
      return res.status(401).json({ success: false, message: 'Sesi berakhir' });
    }

    try {
      const decoded: any = jwt.verify(token, JWT_SECRET);
      res.json({ success: true, user: decoded });
    } catch (error) {
      res.status(401).json({ success: false, message: 'Token tidak valid' });
    }
  });

  app.get('/api/requests', isAdmin, async (req: any, res: any) => {
    const page = parseInt(req.query.page || '1');
    const limit = req.query.limit === 'all' ? 10000 : Math.min(parseInt(req.query.limit || '10') || 10, 10000);
    const offset = (page - 1) * limit;
    const status = req.query.status;
    const priority = req.query.priority;
    const search = req.query.search;

    let query = 'SELECT * FROM reset_requests';
    let countQuery = 'SELECT COUNT(*) as count FROM reset_requests';
    let params: any[] = [];
    let whereClauses: string[] = ['is_deleted = 0'];

    // Role-based filtering: 'user' role is strictly restricted to their own kesatuan
    if (req.user.role === 'user') {
      console.log(`[GET /api/requests] Filtering for ${req.user.role}: ${req.user.kesatuan}`);
      whereClauses.push('kesatuan = TRIM(?)');
      params.push(req.user.kesatuan || '');
    }

    if (status && status !== 'Semua') {
      whereClauses.push('status = ?');
      params.push(status);
    }
    if (priority && priority !== 'Semua') {
      whereClauses.push('prioritas = ?');
      params.push(priority);
    }
    if (search) {
      whereClauses.push('(nama LIKE ? OR nrp LIKE ? OR kesatuan LIKE ?)');
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    if (whereClauses.length > 0) {
      const whereStr = ' WHERE ' + whereClauses.join(' AND ');
      query += whereStr;
      countQuery += whereStr;
    }

    query += ' ORDER BY createdAt DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const [rows]: any = await pool.query(query, params);
    const [totalRows]: any = await pool.query(countQuery, params.slice(0, -2));

    const parsedRows = rows.map((r: any) => ({
      ...r,
      reset_password: r.reset_password ? decryptResetPassword(r.reset_password) : null,
      reset_info: r.reset_info ? JSON.parse(r.reset_info) : undefined
    }));

    res.json({
      data: parsedRows,
      total: totalRows[0].count,
      page,
      limit
    });
  });

  app.get('/api/download-template', isAdmin, exportLimiter, async (req: any, res: any) => {
    try {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet('Template Import');
      let filename: string;

      if (req.user.role === 'user') {
        const userKesatuan = req.user.kesatuan || '';

        // Set column widths
        worksheet.getColumn('A').width = 30;
        worksheet.getColumn('B').width = 20;
        worksheet.getColumn('C').width = 20;
        worksheet.getColumn('D').width = 30;
        worksheet.getColumn('E').width = 30;
        worksheet.getColumn('F').width = 20;
        worksheet.getColumn('G').width = 40;

        // Add Format as Table (Excel Table)
        worksheet.addTable({
          name: 'TabelPersonel',
          ref: 'A1',
          headerRow: true,
          totalsRow: false,
          style: {
            theme: 'TableStyleMedium2',
            showRowStripes: true,
          },
          columns: [
            { name: 'Nama Personel', filterButton: false },
            { name: 'NRP / NIP', filterButton: false },
            { name: 'Pangkat', filterButton: false },
            { name: 'JABATAN', filterButton: false },
            { name: 'KESATUAN', filterButton: false },
            { name: 'PRIORITAS', filterButton: false },
            { name: 'KETERANGAN', filterButton: false }
          ],
          rows: [
            [
              'Budi Santoso',
              '12345678',
              'Briptu',
              'Banum Subbag Renmin',
              userKesatuan, // Will be overwritten with formula
              'Bukan Prioritas',
              'Lupa password login aplikasi'
            ]
          ]
        });

        // Force NRP column to be text
        worksheet.getColumn('B').numFmt = '@';

        // 1. Smart Pre-fill KESATUAN using Formula so Table auto-expands it
        const kesatuanCell = worksheet.getCell('E2');
        kesatuanCell.value = { formula: `"${userKesatuan}"`, result: userKesatuan } as any;

        // 2. Data Validation for PRIORITAS (Column F)
        // Apply to a large range to ensure it's always there, even if user pastes
        for (let i = 2; i <= 1000; i++) {
          const prioritasCell = worksheet.getCell(`F${i}`);
          prioritasCell.dataValidation = {
            type: 'list',
            allowBlank: true,
            formulae: ['"Bukan Prioritas,Prioritas Mendesak"'],
            showErrorMessage: true,
            errorTitle: 'Prioritas Tidak Valid',
            error: 'Silakan pilih dari daftar: Bukan Prioritas atau Prioritas Mendesak'
          };
        }

        filename = `template_reset_${userKesatuan.replace(/\s+/g, '_').toLowerCase()}.xlsx`;
      } else {
        worksheet.columns = [
          { header: 'No', key: 'no', width: 5 },
          { header: 'Nama Lengkap', key: 'nama', width: 30 },
          { header: 'Jabatan', key: 'jabatan', width: 30 },
          { header: 'NRP', key: 'nrp', width: 20 },
          { header: 'Kesatuan', key: 'kesatuan', width: 25 },
          { header: 'Prioritas', key: 'prioritas', width: 15 }
        ];
        filename = 'template_reset_password.xlsx';
      }

      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.setHeader('Content-Disposition', `attachment; filename=${filename}`);

      await workbook.xlsx.write(res);
      res.end();
    } catch (error) {
      console.error('Error generating template:', error);
      res.status(500).send('Gagal membuat template Excel');
    }
  });

  app.get('/api/export-data', isAdmin, exportLimiter, async (req: any, res: any) => {
    const status = req.query.status;
    const priority = req.query.priority;
    const search = req.query.search;

    let query = 'SELECT id, createdAt, nama, pangkat, nrp, kesatuan, jabatan, status, reset_password FROM reset_requests';
    let params: any[] = [];
    let whereClauses: string[] = ['is_deleted = 0'];

    if (req.user.role !== 'superadmin') {
      whereClauses.push('kesatuan = ?');
      params.push(String(req.user.kesatuan || '').trim());
    }

    if (status && status !== 'Semua') {
      whereClauses.push('status = ?');
      params.push(status);
    }
    if (priority && priority !== 'Semua') {
      whereClauses.push('prioritas = ?');
      params.push(priority);
    }
    if (search) {
      whereClauses.push('(nama LIKE ? OR nrp LIKE ? OR kesatuan LIKE ?)');
      const s = `%${search}%`;
      params.push(s, s, s);
    }

    if (whereClauses.length > 0) {
      query += ' WHERE ' + whereClauses.join(' AND ');
    }

    query += ' ORDER BY createdAt DESC';

    const [rows]: any = await pool.query(query, params);

    const dataToExport = rows.map((r: any, index: number) => ({
      'No': index + 1,
      'Waktu Request': new Date(r.createdAt).toLocaleString('id-ID'),
      'Nama': r.nama,
      'Pangkat': r.pangkat,
      'NRP/NIP': r.nrp,
      'Kesatuan': r.kesatuan,
      'Jabatan': r.jabatan,
      'Status': r.status,
      'Password Baru': (r.reset_password ? decryptResetPassword(r.reset_password) : null) || '-'
    }));

    const ws = XLSX.utils.json_to_sheet(dataToExport);

    // Force NRP/NIP column (index 4) to be text
    const range = XLSX.utils.decode_range(ws['!ref'] || 'A1');
    for (let R = range.s.r + 1; R <= range.e.r; ++R) {
      const cell_address = { c: 4, r: R };
      const cell_ref = XLSX.utils.encode_cell(cell_address);
      if (ws[cell_ref]) {
        ws[cell_ref].t = 's'; // Set type to string
      }
    }

    // Set column widths
    const wscols = [
      { wch: 5 },
      { wch: 25 },
      { wch: 25 },
      { wch: 15 },
      { wch: 20 },
      { wch: 25 },
      { wch: 25 },
      { wch: 15 },
      { wch: 20 }
    ];
    ws['!cols'] = wscols;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Permintaan Reset");

    const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename=permintaan_reset_${Date.now()}.xlsx`);
    res.send(buffer);
  });

  app.get('/api/validate-nrp', isAdmin, async (req: any, res: any) => {
    const { nrp, nama } = req.query;
    if (!nrp) return res.status(400).json({ success: false, message: 'NRP wajib diisi' });

    try {
      // Data isolation: check within kesatuan if not superadmin (leveraging idx_req_active_nrp)
      let query = 'SELECT nama FROM reset_requests WHERE nrp = ? AND is_deleted = 0';
      let params = [nrp];

      if (req.user.role !== 'superadmin') {
        query += ' AND kesatuan = TRIM(?)';
        params.push(String(req.user.kesatuan || '').trim());
      }

      const [rows]: any = await pool.query(query, params);

      if (rows.length > 0) {
        const existingNama = rows[0].nama.trim();
        const inputNama = (nama || '').trim();

        if (existingNama.toLowerCase() !== inputNama.toLowerCase()) {
          return res.json({
            success: true,
            conflict: true,
            existingNama
          });
        }
      }

      res.json({ success: true, conflict: false });
    } catch (error) {
      console.error('NRP validation failed:', error);
      res.status(500).json({ success: false, message: 'Gagal melakukan validasi NRP' });
    }
  });

  app.post('/api/requests', isAdmin, uploadKtaLimiter, upload.single('dokumen_kta_file'), async (req: any, res: any) => {
    // Helper to safely clean up orphaned uploaded file on validation failure or error (Fase 6.5)
    const cleanupUploadedFile = () => {
      if (req.file?.path && fs.existsSync(req.file.path)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (unlinkErr) {
          console.error('[CLEANUP] Failed to remove orphaned KTA file:', unlinkErr);
        }
      }
    };

    if (req.user.role === 'admin') {
      cleanupUploadedFile();
      return res.status(403).json({ success: false, message: 'Akses ditolak. Role ADMIN hanya memiliki akses baca (Read-Only).' });
    }

    const r = req.body;
    let filename = r.dokumen_kta || null;

    if (req.file) {
      filename = req.file.filename;
      try {
        // Image Compression (Sharp) implementation
        const filePath = req.file.path;
        if (req.file.mimetype.startsWith('image/')) {
          const buffer = await sharp(filePath)
            .resize(800, null, { withoutEnlargement: true })
            .jpeg({ quality: 80 })
            .toBuffer();
          await fs.promises.writeFile(filePath, buffer);
        }
      } catch (err) {
        console.error("Gagal melakukan kompresi gambar KTA", err);
      }
    }

    // Enforce kesatuan for non-superadmins
    const finalKesatuan = req.user.role !== 'superadmin' ? req.user.kesatuan : (r.kesatuan || 'Polda Jatim');

    // Backend Guard: Reject if KESATUAN doesn't match user's kesatuan (for non-superadmin logged in users)
    if (req.user.role !== 'superadmin') {
      const inputKesatuan = String(r.kesatuan || '').trim().toLowerCase();
      const userKesatuan = String(req.user.kesatuan || '').trim().toLowerCase();

      if (inputKesatuan !== userKesatuan) {
        cleanupUploadedFile();
        return res.status(403).json({
          success: false,
          message: `Gagal: Anda hanya diizinkan mengunggah data untuk wilayah [${req.user.kesatuan}]. Data wilayah [${r.kesatuan}] ditolak.`
        });
      }
    }

    // Backend Guard: Reject if JABATAN is empty
    if (!r.jabatan || r.jabatan.trim() === '' || r.jabatan === '-') {
      cleanupUploadedFile();
      return res.status(400).json({
        success: false,
        message: `Gagal: Kolom 'JABATAN' untuk personel ${r.nama} (${r.nrp}) tidak boleh kosong. Harap lengkapi data jabatan di file Excel Anda.`
      });
    }

    try {
      const requestId = r.id || `REQ-${Math.floor(1000 + Math.random() * 9000)}`;
      // Override explicitly from server for both single and mass inputs
      const waktuIso = new Date().toISOString();
      const status = 'MENUNGGU';

      let prioritas = r.prioritas || 'Normal';
      // Map Excel values if sent raw
      if (prioritas === 'Bukan Prioritas') prioritas = 'Normal';
      if (prioritas === 'Prioritas Mendesak') prioritas = 'Mendesak';

      const createdAt = Date.now();

      await pool.query(`
        INSERT INTO reset_requests (
          id, nama, pangkat, nrp, jabatan, kesatuan, kontak_person, 
          waktu_iso, status, alasan, catatan, dokumen_kta, prioritas, createdAt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        requestId,
        r.nama,
        r.pangkat,
        r.nrp,
        r.jabatan || '-',
        finalKesatuan,
        r.kontak_person || null,
        waktuIso,
        status,
        r.alasan || 'Import Data',
        r.catatan || null,
        filename,
        prioritas,
        createdAt
      ]);

      // Emit socket event for urgent requests with valid requestId (Fase 6.2)
      if (prioritas === 'Mendesak' || prioritas === 'MENDESAK' || r.prioritas === 'Mendesak' || r.prioritas === 'MENDESAK') {
        io.emit('urgent_request', {
          id: requestId,
          nama: r.nama,
          nrp: r.nrp,
          prioritas: prioritas
        });
      }

      res.json({ success: true, id: requestId, dokumen_kta: filename });
    } catch (error: any) {
      cleanupUploadedFile();
      console.error('Failed to create request:', error);
      if (error.code === 'ER_NO_REFERENCED_ROW_2') {
        return res.status(400).json({
          success: false,
          message: `Kesatuan '${finalKesatuan}' tidak terdaftar dalam referensi unit resmi Polda Jatim. Silakan pilih kesatuan yang valid.`
        });
      }
      res.status(500).json({ success: false, message: 'Gagal menyimpan data ke database' });
    }
  });

  // Fase 8.1 & 8.2: Batch Import Endpoint for Reset Requests (Atomic Transaction & Single Multi-Row Insert)
  app.post('/api/requests/import', isAdmin, importLimiter, async (req: any, res: any) => {
    if (req.user.role === 'admin') {
      return res.status(403).json({ success: false, message: 'Akses ditolak. Role ADMIN hanya memiliki akses baca (Read-Only).' });
    }

    try {
      const items = Array.isArray(req.body) ? req.body : req.body?.items;
      if (!Array.isArray(items)) {
        return res.status(400).json({ success: false, message: 'Data import harus berupa array atau objek { items: [] }' });
      }

      if (items.length === 0) {
        return res.json({ success: true, imported: 0, errors: [] });
      }

      const errors: { row: number; nrp: string; nama: string; existingNama: string }[] = [];
      const validRows: any[] = [];
      const userKesatuan = String(req.user.kesatuan || '').trim();
      const isSuperAdmin = req.user.role === 'superadmin';

      // 1. Initial field validation (Jabatan & Kesatuan restriction)
      const nrpListToCheck: string[] = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const rowNum = item.row || i + 2;
        const nrp = String(item.nrp || item.NRP || '').trim();
        const nama = String(item.nama || item.Nama || '').trim();
        const jabatan = String(item.jabatan || item.Jabatan || '').trim();
        const itemKesatuan = String(item.kesatuan || item.Kesatuan || (isSuperAdmin ? 'Polda Jatim' : userKesatuan)).trim();

        if (!nrp) continue; // skip empty

        if (!jabatan || jabatan === '-' || jabatan.toLowerCase() === 'kosong') {
          errors.push({ row: rowNum, nrp, nama, existingNama: 'JABATAN KOSONG' });
          continue;
        }

        if (!isSuperAdmin && itemKesatuan.toLowerCase() !== userKesatuan.toLowerCase()) {
          errors.push({
            row: rowNum,
            nrp,
            nama,
            existingNama: `Kesatuan tidak sesuai wilayah Anda (${userKesatuan})`
          });
          continue;
        }

        nrpListToCheck.push(nrp);
        validRows.push({
          rowNum,
          id: item.id || `IMP-${Date.now()}-${i}-${Math.floor(100 + Math.random() * 900)}`,
          nama: nama || 'Tanpa Nama',
          pangkat: String(item.pangkat || item.Pangkat || '-').trim(),
          nrp,
          jabatan,
          kesatuan: !isSuperAdmin ? userKesatuan : itemKesatuan,
          kontak_person: item.kontak_person || item.kontak || null,
          alasan: item.alasan || 'Import Data Massal',
          catatan: item.catatan || null,
          prioritas: (item.prioritas === 'Prioritas Mendesak' || item.prioritas === 'Mendesak' || item.prioritas === 'MENDESAK') ? 'Mendesak' : 'Normal',
          dokumen_kta: null
        });
      }

      // 2. Batch conflict check against MySQL database (Fase 8.2 server-side pre-validation)
      const existingNrpMap = new Map<string, string>();
      if (nrpListToCheck.length > 0) {
        let conflictSql = 'SELECT nrp, nama, kesatuan FROM reset_requests WHERE is_deleted = 0 AND nrp IN (?)';
        const conflictParams: any[] = [nrpListToCheck];
        if (!isSuperAdmin) {
          conflictSql += ' AND kesatuan = TRIM(?)';
          conflictParams.push(userKesatuan);
        }
        const [existingRecords]: any = await pool.query(conflictSql, conflictParams);
        for (const rec of existingRecords) {
          existingNrpMap.set(String(rec.nrp).trim(), String(rec.nama).trim());
        }
      }

      // 3. Filter conflicting rows & intra-batch duplicates
      const rowsToInsert: any[] = [];
      const seenBatchNrp = new Map<string, string>();

      for (const row of validRows) {
        const dbNama = existingNrpMap.get(row.nrp);
        if (dbNama && dbNama.toLowerCase() !== row.nama.toLowerCase()) {
          errors.push({ row: row.rowNum, nrp: row.nrp, nama: row.nama, existingNama: dbNama });
          continue;
        }

        const batchNama = seenBatchNrp.get(row.nrp);
        if (batchNama && batchNama.toLowerCase() !== row.nama.toLowerCase()) {
          errors.push({ row: row.rowNum, nrp: row.nrp, nama: row.nama, existingNama: `Konflik nama dalam file: ${batchNama}` });
          continue;
        }
        seenBatchNrp.set(row.nrp, row.nama);
        rowsToInsert.push(row);
      }

      if (rowsToInsert.length === 0) {
        return res.json({ success: true, imported: 0, errors });
      }

      // 4. Atomic transaction & Single batch insert
      const connection = await pool.getConnection();
      try {
        await connection.beginTransaction();

        const waktuIso = new Date().toISOString();
        const status = 'MENUNGGU';
        const createdAt = Date.now();

        const values: any[] = [];
        const placeholders: string[] = [];

        for (const r of rowsToInsert) {
          values.push(
            r.id,
            r.nama,
            r.pangkat,
            r.nrp,
            r.jabatan,
            r.kesatuan,
            r.kontak_person,
            waktuIso,
            status,
            r.alasan,
            r.catatan,
            r.dokumen_kta,
            r.prioritas,
            createdAt
          );
          placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
        }

        const insertQuery = `
          INSERT INTO reset_requests (
            id, nama, pangkat, nrp, jabatan, kesatuan, kontak_person,
            waktu_iso, status, alasan, catatan, dokumen_kta, prioritas, createdAt
          ) VALUES ${placeholders.join(', ')}
        `;

        await connection.query(insertQuery, values);
        await connection.commit();

        // 5. Realtime Socket notification for urgent items
        for (const r of rowsToInsert) {
          if (r.prioritas === 'Mendesak') {
            io.emit('urgent_request', {
              id: r.id,
              nama: r.nama,
              nrp: r.nrp,
              prioritas: r.prioritas
            });
          }
        }

        res.json({
          success: true,
          imported: rowsToInsert.length,
          errors
        });
      } catch (txError: any) {
        await connection.rollback();
        throw txError;
      } finally {
        connection.release();
      }
    } catch (error: any) {
      console.error('Batch import reset requests failed:', error);
      if (error.code === 'ER_NO_REFERENCED_ROW_2') {
        return res.status(400).json({
          success: false,
          message: 'Gagal: Terdapat kesatuan yang tidak terdaftar dalam referensi unit resmi Polda Jatim.'
        });
      }
      res.status(500).json({ success: false, message: 'Gagal memproses batch import tiket ke database' });
    }
  });

  // Secure Download Route - Only accessible by Admin/Super Admin
  app.get('/api/download/kta/:filename', isAdmin, async (req: any, res: any) => {
    const { filename } = req.params;
    const filePath = path.join(PRIVATE_UPLOAD_DIR, filename);

    if (fs.existsSync(filePath)) {
      res.download(filePath);
    } else {
      res.status(404).send('File tidak ditemukan');
    }
  });

  app.put('/api/requests/:id', isAdmin, async (req: any, res: any) => {
    const { id } = req.params;
    const r = req.body;

    if (req.user.role === 'admin') {
      return res.status(403).json({ success: false, message: 'Akses ditolak. Role ADMIN hanya memiliki akses baca (Read-Only).' });
    }

    // Only Super Admin can update requests
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ success: false, message: 'Akses ditolak. Hak akses tidak cukup.' });
    }

    try {
      // Get previous status for logging
      const [prevRows]: any = await pool.query('SELECT status FROM reset_requests WHERE id = ?', [id]);
      const prevStatus = prevRows.length > 0 ? prevRows[0].status : 'Unknown';

      // Convert reset_info to string if it's an object
      const resetInfoStr = r.reset_info ? JSON.stringify(r.reset_info) : null;
      let storedPassword = r.reset_password ? encryptResetPassword(r.reset_password) : null;

      const conn = await mysqlPool.getConnection();
      try {
        await conn.beginTransaction();

        if (r.status === 'SELESAI' && r.reset_password) {
          // Hash for personnel table to maintain secure authentication
          const hashedPassword = await bcrypt.hash(r.reset_password, 10);
          await conn.query('UPDATE personnel SET password = ?, password_encrypted = ?, must_change_password = 1 WHERE nrp = ?', [hashedPassword, storedPassword, r.nrp]);
          // storedPassword remains preserved in reset_requests table encrypted via AES-256-GCM at-rest
        }

        await conn.query(`
          UPDATE reset_requests 
          SET status = ?, 
              reset_password = ?, 
              catatan = ?, 
              updatedAt = ?, 
              reset_info = ?,
              prioritas = ?,
              alasan_penolakan = ?
          WHERE id = ?
        `, [
          r.status,
          storedPassword,
          r.catatan || null,
          r.updatedAt || null,
          resetInfoStr,
          r.prioritas || 'Normal',
          r.alasan_penolakan || null,
          id
        ]);

        await conn.commit();
      } catch (txErr) {
        await conn.rollback();
        throw txErr;
      } finally {
        conn.release();
      }

      // Asynchronous Logging Check
      if (prevStatus !== r.status) {
        // DO NOT wait for this to finish!
        Promise.resolve().then(async () => {
          const logId = `LOG-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
          const logWaktu = Date.now();
          const pNama = req.user.nama || 'System Admin';
          const pRole = req.user.role || 'superadmin';
          const ipAddr = req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'Unknown';
          const metadata = `Status changed from ${prevStatus} to ${r.status}. Request ID: ${id}`;

          try {
            await pool.query(`
              INSERT INTO logs (id, waktu, user_nama, user_role, aktivitas, keterangan, ipAddress)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `, [logId, logWaktu, pNama, pRole, 'Update Status Request', metadata, ipAddr]);
          } catch (e) {
            console.error('Async logging failed:', e);
          }
        });
      }

      // If status is DITOLAK, send email notification
      if (r.status === 'DITOLAK') {
        const [userRows]: any = await pool.query('SELECT email FROM personnel WHERE nrp = ?', [r.nrp]);
        const userEmail = userRows.length > 0 ? userRows[0].email : null;

        if (userEmail) {
          const mailOptions = {
            from: process.env.SMTP_USER || 'your-email@polda-jatim.go.id',
            to: userEmail,
            subject: 'Permohonan Reset Password Ditolak',
            text: `Halo ${r.nama},\n\nPermohonan reset password Anda dengan ID ${id} telah ditolak.\n\nAlasan Penolakan: ${r.alasan_penolakan}\n\nSilakan hubungi administrator jika ada pertanyaan.\n\nTerima kasih.`
          };
          await transporter.sendMail(mailOptions);
        }
      }

      // Emit socket event if priority changed to urgent
      if (r.prioritas === 'Mendesak' || r.prioritas === 'MENDESAK') {
        io.emit('urgent_request', {
          id: id,
          nama: r.nama,
          nrp: r.nrp,
          prioritas: r.prioritas
        });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Failed to update request:', error);
      res.status(500).json({ success: false, message: 'Gagal memperbarui data di database' });
    }
  });

  app.delete('/api/requests/:id', isAdmin, async (req: any, res: any) => {
    const { id } = req.params;

    if (req.user.role === 'admin') {
      return res.status(403).json({ success: false, message: 'Akses ditolak. Role ADMIN hanya memiliki akses baca (Read-Only).' });
    }

    // Only Super Admin can delete requests
    if (req.user.role !== 'superadmin') {
      return res.status(403).json({ success: false, message: 'Akses ditolak. Hak akses tidak cukup.' });
    }

    await pool.query('UPDATE reset_requests SET is_deleted = 1 WHERE id = ?', [id]);
    res.json({ success: true });
  });

  app.get('/api/logs', isAdmin, async (req: any, res: any) => {
    try {
      if (req.user?.role !== 'superadmin') {
        return res.status(403).json({ success: false, message: 'Akses ditolak. Log sistem hanya dapat diakses oleh Super Admin.' });
      }

      const [rows]: any = await pool.query('SELECT id, waktu, user_nama, user_role, aktivitas, keterangan, ipAddress FROM logs ORDER BY waktu DESC LIMIT 1000');
      const mappedLogs = rows.map((row: any) => ({
        id: row.id,
        waktu: Number(row.waktu),
        user: {
          nama: row.user_nama,
          role: row.user_role,
          initials: row.user_nama ? row.user_nama.split(' ').map((n: string) => n[0]).join('').toUpperCase() : ''
        },
        aktivitas: row.aktivitas,
        keterangan: row.keterangan,
        ipAddress: row.ipAddress
      }));
      res.json(mappedLogs);
    } catch (error) {
      console.error('Failed to fetch logs:', error);
      res.status(500).json({ success: false, message: 'Gagal mengambil data log' });
    }
  });

  app.post('/api/logs', isAdmin, async (req: any, res: any) => {
    try {
      const { aktivitas, keterangan } = req.body;
      if (!aktivitas || typeof aktivitas !== 'string') {
        return res.status(400).json({ success: false, message: 'Aktivitas log harus diisi' });
      }

      // Ambil identitas pengguna mutlak dari token JWT sesi (req.user), bukan dari input client
      const userNama = req.user?.nama || 'Unknown User';
      let userRole = 'User';
      if (req.user?.role === 'superadmin') {
        userRole = 'Super Admin';
      } else if (req.user?.role === 'admin') {
        userRole = 'Admin Polres';
      } else if (req.user?.role === 'user') {
        userRole = 'Operator/User';
      }

      // Ekstraksi alamat IP asli dari koneksi
      const rawIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
      let ipAddress = '127.0.0.1';
      if (typeof rawIp === 'string' && rawIp.trim()) {
        ipAddress = rawIp.split(',')[0].trim();
      } else if (Array.isArray(rawIp) && rawIp.length > 0) {
        ipAddress = rawIp[0].trim();
      }
      if (ipAddress.startsWith('::ffff:')) {
        ipAddress = ipAddress.replace('::ffff:', '');
      }

      const safeAktivitas = aktivitas.slice(0, 255);
      const safeKeterangan = typeof keterangan === 'string' ? keterangan.slice(0, 1000) : '';
      const logId = `L-${Date.now()}-${Math.floor(1000 + Math.random() * 9000)}`;
      const logWaktu = Date.now();

      await pool.query(`
        INSERT INTO logs (id, waktu, user_nama, user_role, aktivitas, keterangan, ipAddress)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [logId, logWaktu, userNama, userRole, safeAktivitas, safeKeterangan, ipAddress]);

      res.json({
        success: true,
        log: {
          id: logId,
          waktu: logWaktu,
          user: {
            nama: userNama,
            role: userRole,
            initials: userNama.split(' ').map((n: string) => n[0]).join('').toUpperCase()
          },
          aktivitas: safeAktivitas,
          keterangan: safeKeterangan,
          ipAddress
        }
      });
    } catch (error) {
      console.error('Failed to create log:', error);
      res.status(500).json({ success: false, message: 'Gagal menyimpan log' });
    }
  });



  // Vite Middleware
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        hmr: { server }
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*all', (_req: any, res: any) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Helper to dynamically check if a port is available
  const checkPortAvailable = (portToTest: number): Promise<boolean> => {
    return new Promise((resolve) => {
      const tester = net.createServer()
        .once('error', () => resolve(false))
        .once('listening', () => tester.close(() => resolve(true)))
        .listen(portToTest, '0.0.0.0');
    });
  };

  const getAvailablePort = async (startPort: number): Promise<number> => {
    let portToTry = startPort;
    while (!(await checkPortAvailable(portToTry))) {
      console.warn(`⚠️ [PORT CONFLICT] Port ${portToTry} sedang digunakan oleh service lain. Mengalihkan ke port ${portToTry + 1}...`);
      portToTry++;
    }
    return portToTry;
  };

  const activePort = await getAvailablePort(PORT);

  server.listen(activePort, '0.0.0.0', () => {
    console.log(`================================================================`);
    console.log(`🚀 SI-PANDU POLRI SERVER AKTIF & SIAP DIGUNAKAN`);
    console.log(`📡 URL Web & API : http://localhost:${activePort}`);
    console.log(`⚡ Socket.IO     : Terintegrasi pada http://localhost:${activePort}`);
    console.log(`================================================================`);
  });
}

if (process.env.NODE_ENV !== 'test') {
  startServer();
}

export { app, server };
