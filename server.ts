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
import session from 'express-session';
import cookieParser from 'cookie-parser';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';

import jwt from 'jsonwebtoken';
import nodemailer from 'nodemailer';
import { rateLimit } from 'express-rate-limit';
import sharp from 'sharp';
import crypto from 'crypto';

dotenv.config();

const app = express();

const publicRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Limit each IP to 50 requests per windowMs (optimized to not disturb testing)
  message: { success: false, message: "Terlalu banyak permintaan dari IP Anda, silakan coba lagi setelah 15 menit." },
  standardHeaders: true,
  legacyHeaders: false,
});

const mfaVerifyLimiter = rateLimit({
  windowMs: 5 * 60 * 1000, // 5 minutes
  max: 10, // Max 10 verify attempts per 5 minutes per IP
  message: { success: false, message: "Terlalu banyak percobaan verifikasi OTP dari IP Anda. Silakan coba lagi setelah 5 menit." },
  standardHeaders: true,
  legacyHeaders: false,
});

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});
const PORT = 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'polda-jatim-jwt-secret-2024';

app.use(cors({
  origin: true,
  credentials: true
}));
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ limit: '20mb', extended: true }));
app.use(cookieParser());

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

async function initializeDatabase() {
  try {
    console.log('[DATABASE] Connecting strictly to MySQL/MariaDB...');
    const dbName = process.env.DB_NAME || 'polda_jatim_reset';
    
    // Create initial connection without selecting a database to ensure it exists
    const initialPool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || 'B3lpasshooter1004.',
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
      password: process.env.DB_PASSWORD || 'B3lpasshooter1004.',
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
        password TEXT NOT NULL,
        status VARCHAR(50) DEFAULT 'Aktif',
        is_deleted BOOLEAN DEFAULT 0,
        lastLogin BIGINT,
        must_change_password BOOLEAN DEFAULT 0
      )
    `);

    // MIGRATION: Add must_change_password to existing table dynamically
    await safeAlterQuery("ALTER TABLE personnel ADD COLUMN must_change_password TINYINT(1) DEFAULT 0");
    await safeAlterQuery("ALTER TABLE personnel ADD COLUMN telepon VARCHAR(50) DEFAULT NULL");
    await safeAlterQuery("ALTER TABLE personnel ADD COLUMN foto LONGTEXT DEFAULT NULL");

    // Prune redundant single-column indexes that mislead query optimizer
    await safeDropIndexQuery('personnel', 'idx_kesatuan');
    await safeDropIndexQuery('personnel', 'idx_status');

    // Add high-performance covering and composite indexes safely
    await safeAlterQuery("ALTER TABLE personnel ADD INDEX idx_per_active_nama (is_deleted, nama)");
    await safeAlterQuery("ALTER TABLE personnel ADD INDEX idx_per_active_unit_nama (is_deleted, kesatuan, nama)");
    await safeAlterQuery("ALTER TABLE personnel ADD INDEX idx_per_active_role (is_deleted, role)");
    await safeAlterQuery("ALTER TABLE personnel ADD INDEX idx_per_active_unit_role (is_deleted, kesatuan, role)");
    await safeAlterQuery("ALTER TABLE personnel ADD INDEX idx_per_email_active (email, is_deleted)");
    await safeAlterQuery("ALTER TABLE personnel ADD INDEX idx_per_nrp_active (nrp, is_deleted)");
    await safeAlterQuery("ALTER TABLE personnel ADD INDEX idx_email (email)");

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
        dokumen_kta TEXT,
        prioritas VARCHAR(50),
        createdAt BIGINT,
        updatedAt BIGINT,
        reset_password TEXT,
        reset_info TEXT,
        is_deleted BOOLEAN DEFAULT 0
      )
    `);

    // Prune suboptimal single-column indexes that force filesort
    await safeDropIndexQuery('reset_requests', 'idx_req_kesatuan');
    await safeDropIndexQuery('reset_requests', 'idx_req_status');

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

    // Table: OTP
    await pool.query(`
      CREATE TABLE IF NOT EXISTS otp_codes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nrp VARCHAR(100) NOT NULL,
        code VARCHAR(10) NOT NULL,
        expiresAt BIGINT NOT NULL,
        token VARCHAR(255),
        isUsed BOOLEAN DEFAULT 0,
        attempts INT DEFAULT 0
      )
    `);

    await safeAlterQuery("ALTER TABLE otp_codes ADD COLUMN attempts INT DEFAULT 0");
    await safeAlterQuery("ALTER TABLE otp_codes ADD INDEX idx_otp_lookup (nrp, isUsed, expiresAt)");
    await safeAlterQuery("ALTER TABLE otp_codes ADD INDEX idx_otp_expires (expiresAt)");
    await safeAlterQuery("ALTER TABLE otp_codes ADD INDEX idx_otp_cleanup (expiresAt, isUsed)");

    // Table: Units index
    await safeAlterQuery("ALTER TABLE units ADD INDEX idx_units_induk (induk)");
    await pool.query("UPDATE units SET nama = TRIM(nama) WHERE nama IS NOT NULL AND nama != TRIM(nama)");

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
      { id: "SA1", nama: "AKBP Budiono", pangkat: "AKBP", nrp: "78010001", jabatan: "Kabid Tik", kesatuan: "Polda Jatim", email: "superadmin1@polri.go.id", role: "superadmin", password: "superadmin123", status: "Aktif" },
      { id: "SA2", nama: "Kompol Siti Aminah", pangkat: "Kompol", nrp: "82050002", jabatan: "Kasubag Tekinfo", kesatuan: "Polda Jatim", email: "superadmin2@polri.go.id", role: "superadmin", password: "siperadmin123", status: "Aktif" },
      { id: "SA3", nama: "Super Admin Demo", pangkat: "Super Admin", nrp: "88010003", jabatan: "Super Admin Subbidtekinfo Bid Tik (Demo)", kesatuan: "Polda Jatim", email: "superadmin.demo@polri.go.id", role: "superadmin", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_URY_JATIM", nama: "Admin Polda Demo", pangkat: "Admin", nrp: "88010004", jabatan: "Admin Subbidtekinfo Bid Tik (Demo)", kesatuan: "Polda Jatim", email: "admin.polda.demo@polri.go.id", role: "admin", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010001", nama: "Polrestabes Surabaya", pangkat: "User", nrp: "90010001", jabatan: "Kasi Tik", kesatuan: "POLRESTABES SURABAYA", email: "sitik.surabaya@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010002", nama: "Polresta Sidoarjo", pangkat: "User", nrp: "90010002", jabatan: "Kasi Tik", kesatuan: "POLRESTA SIDOARJO", email: "sitik.sidoarjo@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010003", nama: "Polres Malang Kota", pangkat: "User", nrp: "90010003", jabatan: "Kasi Tik", kesatuan: "POLRES MALANG KOTA", email: "sitik.malangkota@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010004", nama: "Polresta Banyuwangi", pangkat: "User", nrp: "90010004", jabatan: "Kasi Tik", kesatuan: "POLRESTA BANYUWANGI", email: "sitik.banyuwangi@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010005", nama: "Polres Pelabuhan Tanjung Perak", pangkat: "User", nrp: "90010005", jabatan: "Kasi Tik", kesatuan: "POLRES PELABUHAN TANJUNG PERAK", email: "sitik.tanjungperak@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010006", nama: "Polres Gresik", pangkat: "User", nrp: "90010006", jabatan: "Kasi Tik", kesatuan: "POLRES GRESIK", email: "sitik.gresik@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010007", nama: "Polres Malang", pangkat: "User", nrp: "90010007", jabatan: "Kasi Tik", kesatuan: "POLRES MALANG", email: "sitik.malang@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010008", nama: "Polres Pasuruan", pangkat: "User", nrp: "90010008", jabatan: "Kasi Tik", kesatuan: "POLRES PASURUAN", email: "sitik.pasuruan@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010009", nama: "Polres Pasuruan Kota", pangkat: "User", nrp: "90010009", jabatan: "Kasi Tik", kesatuan: "POLRES PASURUAN KOTA", email: "sitik.pasuruankota@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010010", nama: "Polres Probolinggo", pangkat: "User", nrp: "90010010", jabatan: "Kasi Tik", kesatuan: "POLRES PROBOLINGGO", email: "sitik.probolinggo@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010011", nama: "Polres Probolinggo Kota", pangkat: "User", nrp: "90010011", jabatan: "Kasi Tik", kesatuan: "POLRES PROBOLINGGO KOTA", email: "sitik.probolinggokota@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010012", nama: "Polres Batu", pangkat: "User", nrp: "90010012", jabatan: "Kasi Tik", kesatuan: "POLRES BATU", email: "sitik.batu@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010013", nama: "Polres Lumajang", pangkat: "User", nrp: "90010013", jabatan: "Kasi Tik", kesatuan: "POLRES LUMAJANG", email: "sitik.lumajang@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010014", nama: "Polres Bondowoso", pangkat: "User", nrp: "90010014", jabatan: "Kasi Tik", kesatuan: "POLRES BONDOWOSO", email: "sitik.bondowoso@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010015", nama: "Polres Situbondo", pangkat: "User", nrp: "90010015", jabatan: "Kasi Tik", kesatuan: "POLRES SITUBONDO", email: "sitik.situbondo@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010016", nama: "Polres Jember", pangkat: "User", nrp: "90010016", jabatan: "Kasi Tik", kesatuan: "POLRES JEMBER", email: "sitik.jember@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010017", nama: "Polres Kediri", pangkat: "User", nrp: "90010017", jabatan: "Kasi Tik", kesatuan: "POLRES KEDIRI", email: "sitik.kediri@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010018", nama: "Polres Kediri Kota", pangkat: "User", nrp: "90010018", jabatan: "Kasi Tik", kesatuan: "POLRES KEDIRI KOTA", email: "sitik.kedirikota@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010019", nama: "Polres Tulungagung", pangkat: "User", nrp: "90010019", jabatan: "Kasi Tik", kesatuan: "POLRES TULUNGAGUNG", email: "sitik.tulungagung@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010020", nama: "Polres Blitar", pangkat: "User", nrp: "90010020", jabatan: "Kasi Tik", kesatuan: "POLRES BLITAR", email: "sitik.blitar@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010021", nama: "Polres Blitar Kota", pangkat: "User", nrp: "90010021", jabatan: "Kasi Tik", kesatuan: "POLRES BLITAR KOTA", email: "sitik.blitarkota@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010022", nama: "Polres Trenggalek", pangkat: "User", nrp: "90010022", jabatan: "Kasi Tik", kesatuan: "POLRES TRENGGALEK", email: "sitik.trenggalek@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010023", nama: "Polres Nganjuk", pangkat: "User", nrp: "90010023", jabatan: "Kasi Tik", kesatuan: "POLRES NGANJUK", email: "sitik.nganjuk@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010024", nama: "Polres Jombang", pangkat: "User", nrp: "90010024", jabatan: "Kasi Tik", kesatuan: "POLRES JOMBANG", email: "sitik.jombang@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010025", nama: "Polres Madiun", pangkat: "User", nrp: "90010025", jabatan: "Kasi Tik", kesatuan: "POLRES MADIUN", email: "sitik.madiun@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010026", nama: "Polres Madiun Kota", pangkat: "User", nrp: "90010026", jabatan: "Kasi Tik", kesatuan: "POLRES MADIUN KOTA", email: "sitik.madiunkota@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010027", nama: "Polres Ngawi", pangkat: "User", nrp: "90010027", jabatan: "Kasi Tik", kesatuan: "POLRES NGAWI", email: "sitik.ngawi@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010028", nama: "Polres Magetan", pangkat: "User", nrp: "90010028", jabatan: "Kasi Tik", kesatuan: "POLRES MAGETAN", email: "sitik.magetan@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010029", nama: "Polres Ponorogo", pangkat: "User", nrp: "90010029", jabatan: "Kasi Tik", kesatuan: "POLRES PONOROGO", email: "sitik.ponorogo@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010030", nama: "Polres Pacitan", pangkat: "User", nrp: "90010030", jabatan: "Kasi Tik", kesatuan: "POLRES PACITAN", email: "sitik.pacitan@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010031", nama: "Polres Bojonegoro", pangkat: "User", nrp: "90010031", jabatan: "Kasi Tik", kesatuan: "POLRES BOJONEGORO", email: "sitik.bojonegoro@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010032", nama: "Polres Tuban", pangkat: "User", nrp: "90010032", jabatan: "Kasi Tik", kesatuan: "POLRES TUBAN", email: "sitik.tuban@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010033", nama: "Polres Lamongan", pangkat: "User", nrp: "90010033", jabatan: "Kasi Tik", kesatuan: "POLRES LAMONGAN", email: "sitik.lamongan@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010034", nama: "Polres Mojokerto", pangkat: "User", nrp: "90010034", jabatan: "Kasi Tik", kesatuan: "POLRES MOJOKERTO", email: "sitik.mojokerto@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010035", nama: "Polres Mojokerto Kota", pangkat: "User", nrp: "90010035", jabatan: "Kasi Tik", kesatuan: "POLRES MOJOKERTO KOTA", email: "sitik.mojokertokota@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010036", nama: "Polres Bangkalan", pangkat: "User", nrp: "90010036", jabatan: "Kasi Tik", kesatuan: "POLRES BANGKALAN", email: "sitik.bangkalan@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010037", nama: "Polres Sampang", pangkat: "User", nrp: "90010037", jabatan: "Kasi Tik", kesatuan: "POLRES SAMPANG", email: "sitik.sampang@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010038", nama: "Polres Pamekasan", pangkat: "User", nrp: "90010038", jabatan: "Kasi Tik", kesatuan: "POLRES PAMEKASAN", email: "sitik.pamekasan@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" },
      { id: "ADM_90010039", nama: "Polres Sumenep", pangkat: "User", nrp: "90010039", jabatan: "Kasi Tik", kesatuan: "POLRES SUMENEP", email: "sitik.sumenep@demo.polri.go.id", role: "user", password: "PasswordDemo123!", status: "Aktif" }
    ];

    // Insert Personnel ONLY if table is empty
    const [rows]: any = await pool.query('SELECT COUNT(*) as count FROM personnel');
    if (rows && rows[0] && rows[0].count === 0) {
      console.log('[DATABASE] Menginisialisasi data personel demo...');
      for (const p of mockPersonnel) {
        const hashedPassword = await bcrypt.hash(p.password, 10);
        await pool.query(`
          INSERT IGNORE INTO personnel (id, nama, pangkat, nrp, jabatan, kesatuan, email, role, password, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [p.id, p.nama, p.pangkat, p.nrp, p.jabatan, p.kesatuan, p.email, p.role, hashedPassword, p.status]);
      }
    } else {
      // Ensure existing personnel records are synchronized with dummy credentials (preserving SA1 and SA2 for unit testing)
      for (const p of mockPersonnel) {
        if (p.id === 'SA1' || p.id === 'SA2') continue;
        const hashedPassword = await bcrypt.hash(p.password, 10);
        await pool.query(`
          UPDATE personnel 
          SET id = ?, nama = ?, pangkat = ?, nrp = ?, jabatan = ?, email = ?, password = ?
          WHERE (kesatuan = ? OR id = ?) AND id NOT IN ('SA1', 'SA2') AND id NOT LIKE 'P-%'
        `, [p.id, p.nama, p.pangkat, p.nrp, p.jabatan, p.email, hashedPassword, p.kesatuan, p.id]);
      }
    }

    // Ensure specific admin user exists in dummy form
    const targetEmail = 'admin.polda.demo@polri.go.id';
    const [targetUser]: any = await pool.query('SELECT * FROM personnel WHERE email = ?', [targetEmail]);
    if (targetUser && targetUser.length === 0) {
      console.log(`[DATABASE] Menambahkan user admin khusus: ${targetEmail}`);
      const hashedPassword = await bcrypt.hash('PasswordDemo123!', 10);
      await pool.query(`
        INSERT IGNORE INTO personnel (id, nama, pangkat, nrp, jabatan, kesatuan, email, role, password, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        'ADM_URY_JATIM', 
        'Admin Polda Demo', 
        'Admin', 
        '88010004', 
        'Admin Subbidtekinfo Bid Tik (Demo)', 
        'Polda Jatim', 
        targetEmail, 
        'admin', 
        hashedPassword,
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
            
            fs.writeFileSync(path.join(PUBLIC_UPLOAD_DIR, filename), buffer);
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
          fs.writeFileSync(path.join(PROFILE_UPLOAD_DIR, filename), buffer);
          safeFoto = `/public_uploads/profiles/${filename}`;
        }
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

  app.post('/api/change-password', isAdmin, async (req: any, res: any) => {
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
        'UPDATE personnel SET password = ?, must_change_password = 0 WHERE id = ?',
        [hashedPassword, req.user.id]
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

  app.get('/api/personnel', isAdmin, async (req: any, res: any) => {
    const page = parseInt(req.query.page || '1');
    const limit = req.query.limit === 'all' ? 10000 : Math.min(parseInt(req.query.limit || '10') || 10, 10000);
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const role = req.query.role;
    const kesatuan = req.query.kesatuan;

    let query = 'SELECT id, nama, pangkat, nrp, jabatan, kesatuan, email, role, status, telepon, foto, is_deleted, lastLogin, must_change_password FROM personnel';
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
    
    // Explicitly sanitize rows to guarantee no password hash is ever returned
    const sanitizedRows = rows.map((r: any) => {
      const { password, ...safeUser } = r;
      return safeUser;
    });

    res.json({
      data: sanitizedRows,
      total: totalRows[0].count,
      page,
      limit
    });
  });

  app.post('/api/personnel/import', isAdmin, async (req: any, res: any) => {
    if (req.user.role === 'admin') {
      return res.status(403).json({ success: false, message: 'Akses ditolak.' });
    }
    
    try {
      const personnelData = req.body;
      if (!Array.isArray(personnelData)) return res.status(400).json({ success: false, message: 'Data harus berupa array' });
      
      if (personnelData.length === 0) return res.json({ success: true, imported: 0 });

      // Build bulk insert query
      const values: any[] = [];
      const placeholders = [];
      for (const p of personnelData) {
        const hashedPassword = await bcrypt.hash(p.passwordPlain || 'PasswordDemo123!', 10);
        const finalKesatuan = String(p.kesatuan || '').trim();
        values.push(p.id, p.nama, p.pangkat, p.nrp, p.jabatan, finalKesatuan, p.email, p.role || 'user', hashedPassword, p.status || 'Aktif');
        placeholders.push('(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
      }

      await pool.query(
        `INSERT IGNORE INTO personnel (id, nama, pangkat, nrp, jabatan, kesatuan, email, role, password, status) VALUES ${placeholders.join(', ')}`,
        values
      );
      res.json({ success: true, imported: personnelData.length });
    } catch (e: any) {
      console.error('Bulk import error:', e);
      res.status(500).json({ success: false, message: 'Gagal melakukan import massal ke server' });
    }
  });

  app.post('/api/personnel', isAdmin, async (req: any, res: any) => {
    if (req.user.role === 'admin') {
      return res.status(403).json({ success: false, message: 'Akses ditolak. Role ADMIN hanya memiliki akses baca (Read-Only).' });
    }
    const p = req.body;
    const hashedPassword = await bcrypt.hash(p.password || 'user!1234', 10);
    const finalKesatuan = String(p.kesatuan || '').trim();
    
    try {
      await pool.query(`
        INSERT INTO personnel (id, nama, pangkat, nrp, jabatan, kesatuan, email, role, password, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [p.id, p.nama, p.pangkat, p.nrp, p.jabatan, finalKesatuan, p.email, p.role, hashedPassword, p.status || 'Aktif']);
      res.json({ success: true });
    } catch (error: any) {
      console.error('Failed to create personnel:', error);
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

  app.put('/api/personnel/:id', isAdmin, async (req: any, res: any) => {
    if (req.user.role === 'admin') {
      return res.status(403).json({ success: false, message: 'Akses ditolak. Role ADMIN hanya memiliki akses baca (Read-Only).' });
    }
    const { id } = req.params;
    const p = req.body;
    const finalKesatuan = String(p.kesatuan || '').trim();
    
    try {
      if (p.password) {
        const hashedPassword = await bcrypt.hash(p.password, 10);
        await pool.query(`
          UPDATE personnel 
          SET nama = ?, pangkat = ?, nrp = ?, jabatan = ?, kesatuan = ?, email = ?, role = ?, status = ?, password = ?
          WHERE id = ?
        `, [p.nama, p.pangkat, p.nrp, p.jabatan, finalKesatuan, p.email, p.role, p.status, hashedPassword, id]);
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

  app.delete('/api/personnel/:id', isAdmin, async (req: any, res: any) => {
    if (req.user.role === 'admin') {
      return res.status(403).json({ success: false, message: 'Akses ditolak. Role ADMIN hanya memiliki akses baca (Read-Only).' });
    }
    const { id } = req.params;
    await pool.query('UPDATE personnel SET is_deleted = 1 WHERE id = ?', [id]);
    res.json({ success: true });
  });

  app.post('/api/login', async (req: any, res: any) => {
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

          // Generate Cryptographically Secure 6-digit OTP (100000 - 999999)
          const otpCode = crypto.randomInt(100000, 1000000).toString();
          const expiresAt = Date.now() + (5 * 60 * 1000); // 5 minutes TTL
          const expiryTimeStr = new Date(expiresAt).toLocaleTimeString('id-ID', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: false
          }).replace(/\./g, ':');

          // Save OTP to database using user's NRP as identifier with 0 attempts
          await pool.query('INSERT INTO otp_codes (nrp, code, expiresAt, isUsed, attempts) VALUES (?, ?, ?, 0, 0)', [user.nrp, otpCode, expiresAt]);

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

          // Return response asking for MFA, DO NOT ISSUE JWT YET
          res.json({ 
            success: true, 
            mfa_required: true, 
            identifier: user.nrp,
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
    const { identifier, code } = req.body;

    if (!identifier || !code) {
      return res.status(400).json({ success: false, message: 'Identifier dan Kode OTP wajib diisi' });
    }

    const cleanIdentifier = String(identifier).trim();
    const cleanCode = String(code).trim();

    try {
      // Check latest active OTP for this identifier
      const [otpRows]: any = await pool.query(
        'SELECT * FROM otp_codes WHERE nrp = ? AND isUsed = 0 AND expiresAt > ? ORDER BY id DESC LIMIT 1',
        [cleanIdentifier, Date.now()]
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

      // Check OTP code match
      if (activeOtp.code !== cleanCode) {
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
      const [userRows]: any = await pool.query('SELECT * FROM personnel WHERE nrp = ? AND is_deleted = 0', [cleanIdentifier]);
      if (userRows.length === 0) {
        return res.status(404).json({ success: false, message: 'Data pengguna tidak ditemukan atau akun telah dinonaktifkan' });
      }

      const user = userRows[0];
      const { password: _, ...userWithoutPassword } = user;
      
      // Update lastLogin
      await pool.query('UPDATE personnel SET lastLogin = ? WHERE id = ?', [Date.now(), user.id]);

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
      reset_info: r.reset_info ? JSON.parse(r.reset_info) : undefined
    }));

    res.json({
      data: parsedRows,
      total: totalRows[0].count,
      page,
      limit
    });
  });

  app.get('/api/download-template', isAdmin, async (req: any, res: any) => {
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

  app.get('/api/export-data', isAdmin, async (req: any, res: any) => {
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
      'Password Baru': r.reset_password || '-'
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
      {wch: 5},
      {wch: 25},
      {wch: 25},
      {wch: 15},
      {wch: 20},
      {wch: 25},
      {wch: 25},
      {wch: 15},
      {wch: 20}
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

  app.post('/api/requests', isAdmin, upload.single('dokumen_kta_file'), async (req: any, res: any) => {
    if (req.user.role === 'admin') {
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
          fs.writeFileSync(filePath, buffer);
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
        return res.status(403).json({ 
          success: false, 
          message: `Gagal: Anda hanya diizinkan mengunggah data untuk wilayah [${req.user.kesatuan}]. Data wilayah [${r.kesatuan}] ditolak.` 
        });
      }
    }

    // Backend Guard: Reject if JABATAN is empty
    if (!r.jabatan || r.jabatan.trim() === '' || r.jabatan === '-') {
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

      // Emit socket event for urgent requests
      if (r.prioritas === 'Mendesak' || r.prioritas === 'MENDESAK') {
        io.emit('urgent_request', {
          id: r.id,
          nama: r.nama,
          nrp: r.nrp,
          prioritas: r.prioritas
        });
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Failed to create request:', error);
      res.status(500).json({ success: false, message: 'Gagal menyimpan data ke database' });
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
      let storedPassword = r.reset_password || null;

      const conn = await mysqlPool.getConnection();
      try {
        await conn.beginTransaction();

        if (r.status === 'SELESAI' && r.reset_password) {
          // Hash for personnel table to maintain secure authentication
          const hashedPassword = await bcrypt.hash(r.reset_password, 10);
          await conn.query('UPDATE personnel SET password = ?, must_change_password = 1 WHERE nrp = ?', [hashedPassword, r.nrp]);
          // storedPassword remains preserved in reset_requests table so IT Si TIK Polres can hand it over to the personnel
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
          } catch(e) {
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
      server: { middlewareMode: true },
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

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
