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

dotenv.config();

const app = express();

const publicRequestLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 50, // Limit each IP to 50 requests per windowMs (optimized to not disturb testing)
  message: { success: false, message: "Terlalu banyak permintaan dari IP Anda, silakan coba lagi setelah 15 menit." },
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
  try {
    return await pool.query(sql, params);
  } catch (err: any) {
    if (err.code === 'ER_DUP_KEYNAME' || err.errno === 1061 || 
        err.code === 'ER_DUP_FIELDNAME' || err.errno === 1060) {
      return null;
    }
    console.error(`Query failed:`, err);
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
      await initialPool.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\``);
      console.log(`[DATABASE] Database '${dbName}' siap digunakan/berhasil dibuat.`);
    } catch (e: any) {
      console.error(`[DATABASE ERROR] Gagal mengecek/membuat database '${dbName}': ${e.message}`);
    } finally {
      await initialPool.end();
    }

    mysqlPool = mysql.createPool({
      host: process.env.DB_HOST || 'localhost',
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      database: dbName,
      port: parseInt(process.env.DB_PORT || '3306'),
      waitForConnections: true,
      connectionLimit: 10,
      connectTimeout: 10000,
      queueLimit: 0
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

    // Table: Personnel (with Soft Deletes)
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
        lastLogin BIGINT
      )
    `);

    // Add indexes for optimization safely
    await safeAlterQuery("ALTER TABLE personnel ADD INDEX idx_nrp (nrp)");
    await safeAlterQuery("ALTER TABLE personnel ADD INDEX idx_email (email)");
    await safeAlterQuery("ALTER TABLE personnel ADD INDEX idx_status (status)");
    await safeAlterQuery("ALTER TABLE personnel ADD INDEX idx_kesatuan (kesatuan)");

    // Ensure role is lowercase and update existing data
    await pool.query("UPDATE personnel SET role = LOWER(role)");

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

    await safeAlterQuery("ALTER TABLE reset_requests ADD INDEX idx_req_nrp (nrp)");
    await safeAlterQuery("ALTER TABLE reset_requests ADD INDEX idx_req_status (status)");
    await safeAlterQuery("ALTER TABLE reset_requests ADD INDEX idx_req_kesatuan (kesatuan)");

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

    // Table: OTP
    await pool.query(`
      CREATE TABLE IF NOT EXISTS otp_codes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        nrp VARCHAR(100) NOT NULL,
        code VARCHAR(10) NOT NULL,
        expiresAt BIGINT NOT NULL,
        token VARCHAR(255),
        isUsed BOOLEAN DEFAULT 0
      )
    `);

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

    // --- MIGRATION DATA FROM mock-data.ts ---
    const mockPersonnel = [
      { id: "SA1", nama: "AKBP Budiono", pangkat: "AKBP", nrp: "78010001", jabatan: "Kabid Tik", kesatuan: "Polda Jatim", email: "superadmin1@polri.go.id", role: "superadmin", password: "superadmin123", status: "Aktif" },
      { id: "SA2", nama: "Kompol Siti Aminah", pangkat: "Kompol", nrp: "82050002", jabatan: "Kasubag Tekinfo", kesatuan: "Polda Jatim", email: "superadmin2@polri.go.id", role: "superadmin", password: "siperadmin123", status: "Aktif" },
      { id: "SA3", nama: "URYANDUKNIS", pangkat: "Super Admin", nrp: "410804003", jabatan: "URYANDUKNIS SUBBIDTEKINFO BID TIK POLDA JATIM", kesatuan: "Polda Jatim", email: "uryanduknis.superadmin@polri.go.id", role: "superadmin", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_URY_JATIM", nama: "URYANDUKNIS SUBBIDTEKINFO", pangkat: "Admin", nrp: "410804004", jabatan: "Admin Tekinfo Bid Tik", kesatuan: "Polda Jatim", email: "uryanduknissubbidtekinfobidtik.jatim@polri.go.id", role: "admin", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_416409000", nama: "Polrestabes Surabaya", pangkat: "User", nrp: "416409000", jabatan: "Kasi Tik", kesatuan: "POLRESTABES SURABAYA", email: "sitikrestabessurabaya.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_415809000", nama: "Polresta Sidoarjo", pangkat: "User", nrp: "415809000", jabatan: "Kasi Tik", kesatuan: "POLRESTA SIDOARJO", email: "sitikrestasidoarjo.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_414409000", nama: "Polres Malang Kota", pangkat: "User", nrp: "414409000", jabatan: "Kasi Tik", kesatuan: "POLRES MALANG KOTA", email: "sitikresmalangkota.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_412709000", nama: "Polresta Banyuwangi", pangkat: "User", nrp: "412709000", jabatan: "Kasi Tik", kesatuan: "POLRESTA BANYUWANGI", email: "sitikrestabanyuwangi.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_415309000", nama: "Polres Pelabuhan Tanjung Perak", pangkat: "User", nrp: "415309000", jabatan: "Kasi Tik", kesatuan: "POLRES PELABUHAN TANJUNG PERAK", email: "sitikrespelabuhantanjungperak.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_413309000", nama: "Polres Gresik", pangkat: "User", nrp: "413309000", jabatan: "Kasi Tik", kesatuan: "POLRES GRESIK", email: "sitikresgresik.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_414309000", nama: "Polres Malang", pangkat: "User", nrp: "414309000", jabatan: "Kasi Tik", kesatuan: "POLRES MALANG", email: "sitikresmalang.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_415109000", nama: "Polres Pasuruan", pangkat: "User", nrp: "415109000", jabatan: "Kasi Tik", kesatuan: "POLRES PASURUAN", email: "sitikrespasuruan.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_415209000", nama: "Polres Pasuruan Kota", pangkat: "User", nrp: "415209000", jabatan: "Kasi Tik", kesatuan: "POLRES PASURUAN KOTA", email: "sitikrespasuruankota.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_415509000", nama: "Polres Probolinggo", pangkat: "User", nrp: "415509000", jabatan: "Kasi Tik", kesatuan: "POLRES PROBOLINGGO", email: "sitikresprobolinggo.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_415609000", nama: "Polres Probolinggo Kota", pangkat: "User", nrp: "415609000", jabatan: "Kasi Tik", kesatuan: "POLRES PROBOLINGGO KOTA", email: "sitikresprobolinggokota.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_412809000", nama: "Polres Batu", pangkat: "User", nrp: "412809000", jabatan: "Kasi Tik", kesatuan: "POLRES BATU", email: "sitikresbatu.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_413909000", nama: "Polres Lumajang", pangkat: "User", nrp: "413909000", jabatan: "Kasi Tik", kesatuan: "POLRES LUMAJANG", email: "sitikreslumajang.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_413209000", nama: "Polres Bondowoso", pangkat: "User", nrp: "413209000", jabatan: "Kasi Tik", kesatuan: "POLRES BONDOWOSO", email: "sitikresbondowoso.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_415909000", nama: "Polres Situbondo", pangkat: "User", nrp: "415909000", jabatan: "Kasi Tik", kesatuan: "POLRES SITUBONDO", email: "sitikressitubondo.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_413409000", nama: "Polres Jember", pangkat: "User", nrp: "413409000", jabatan: "Kasi Tik", kesatuan: "POLRES JEMBER", email: "sitikresjember.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_413609000", nama: "Polres Kediri", pangkat: "User", nrp: "413609000", jabatan: "Kasi Tik", kesatuan: "POLRES KEDIRI", email: "sitikreskediri.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_413709000", nama: "Polres Kediri Kota", pangkat: "User", nrp: "413709000", jabatan: "Kasi Tik", kesatuan: "POLRES KEDIRI KOTA", email: "sitikreskedirikota.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_416309000", nama: "Polres Tulungagung", pangkat: "User", nrp: "416309000", jabatan: "Kasi Tik", kesatuan: "POLRES TULUNGAGUNG", email: "sitikrestulungagung.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_412909000", nama: "Polres Blitar", pangkat: "User", nrp: "412909000", jabatan: "Kasi Tik", kesatuan: "POLRES BLITAR", email: "sitikresblitar.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_413009000", nama: "Polres Blitar Kota", pangkat: "User", nrp: "413009000", jabatan: "Kasi Tik", kesatuan: "POLRES BLITAR KOTA", email: "sitikresblitarkota.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_416109000", nama: "Polres Trenggalek", pangkat: "User", nrp: "416109000", jabatan: "Kasi Tik", kesatuan: "POLRES TRENGGALEK", email: "sitikrestrenggalek.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_414709000", nama: "Polres Nganjuk", pangkat: "User", nrp: "414709000", jabatan: "Kasi Tik", kesatuan: "POLRES NGANJUK", email: "sitikresnganjuk.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_413509000", nama: "Polres Jombang", pangkat: "User", nrp: "413509000", jabatan: "Kasi Tik", kesatuan: "POLRES JOMBANG", email: "sitikresjombang.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_414009000", nama: "Polres Madiun", pangkat: "User", nrp: "414009000", jabatan: "Kasi Tik", kesatuan: "POLRES MADIUN", email: "sitikresmadiun.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_414109000", nama: "Polres Madiun Kota", pangkat: "User", nrp: "414109000", jabatan: "Kasi Tik", kesatuan: "POLRES MADIUN KOTA", email: "sitikresmadiunkota.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_414809000", nama: "Polres Ngawi", pangkat: "User", nrp: "414809000", jabatan: "Kasi Tik", kesatuan: "POLRES NGAWI", email: "sitikresngawi.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_414209000", nama: "Polres Magetan", pangkat: "User", nrp: "414209000", jabatan: "Kasi Tik", kesatuan: "POLRES MAGETAN", email: "sitikresmagetan.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_415409000", nama: "Polres Ponorogo", pangkat: "User", nrp: "415409000", jabatan: "Kasi Tik", kesatuan: "POLRES PONOROGO", email: "sitikresponorogo.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_414909000", nama: "Polres Pacitan", pangkat: "User", nrp: "414909000", jabatan: "Kasi Tik", kesatuan: "POLRES PACITAN", email: "sitikrespacitan.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_413109000", nama: "Polres Bojonegoro", pangkat: "User", nrp: "413109000", jabatan: "Kasi Tik", kesatuan: "POLRES BOJONEGORO", email: "sitikresbojonegoro.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_416209000", nama: "Polres Tuban", pangkat: "User", nrp: "416209000", jabatan: "Kasi Tik", kesatuan: "POLRES TUBAN", email: "sitikrestuban.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_413809000", nama: "Polres Lamongan", pangkat: "User", nrp: "413809000", jabatan: "Kasi Tik", kesatuan: "POLRES LAMONGAN", email: "sitikreslamongan.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_414509000", nama: "Polres Mojokerto", pangkat: "User", nrp: "414509000", jabatan: "Kasi Tik", kesatuan: "POLRES MOJOKERTO", email: "sitikresmojokerto.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_414609000", nama: "Polres Mojokerto Kota", pangkat: "User", nrp: "414609000", jabatan: "Kasi Tik", kesatuan: "POLRES MOJOKERTO KOTA", email: "sitikresmojokertokota.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_412609000", nama: "Polres Bangkalan", pangkat: "User", nrp: "412609000", jabatan: "Kasi Tik", kesatuan: "POLRES BANGKALAN", email: "sitikresbangkalan.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_415709000", nama: "Polres Sampang", pangkat: "User", nrp: "415709000", jabatan: "Kasi Tik", kesatuan: "POLRES SAMPANG", email: "sitikressampang.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_415009000", nama: "Polres Pamekasan", pangkat: "User", nrp: "415009000", jabatan: "Kasi Tik", kesatuan: "POLRES PAMEKASAN", email: "sitikrespamekasan.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" },
      { id: "ADM_416009000", nama: "Polres Sumenep", pangkat: "User", nrp: "416009000", jabatan: "Kasi Tik", kesatuan: "POLRES SUMENEP", email: "sitikressumenep.jatim@polri.go.id", role: "user", password: "pCtAi9T2221G", status: "Aktif" }
    ];

    // Insert Personnel ONLY if table is empty or missing these users
    const [rows]: any = await pool.query('SELECT COUNT(*) as count FROM personnel');
    if (rows && rows[0] && rows[0].count === 0) {
      console.log('[DATABASE] Melakukan migrasi data personel dari mock-data...');
      for (const p of mockPersonnel) {
        const hashedPassword = await bcrypt.hash(p.password, 10);
        await pool.query(`
          INSERT IGNORE INTO personnel (id, nama, pangkat, nrp, jabatan, kesatuan, email, role, password, status)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `, [p.id, p.nama, p.pangkat, p.nrp, p.jabatan, p.kesatuan, p.email, p.role, hashedPassword, p.status]);
      }
    }

    // Ensure specific admin user requested by the user exists
    const targetEmail = 'uryanduknissubbidtekinfobidtik.jatim@polri.go.id';
    const [targetUser]: any = await pool.query('SELECT * FROM personnel WHERE email = ?', [targetEmail]);
    if (targetUser && targetUser.length === 0) {
      console.log(`[DATABASE] Menambahkan user admin khusus: ${targetEmail}`);
      const hashedPassword = await bcrypt.hash('pCtAi9T2221G', 10);
      await pool.query(`
        INSERT IGNORE INTO personnel (id, nama, pangkat, nrp, jabatan, kesatuan, email, role, password, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        'ADM_URY_JATIM', 
        'URYANDUKNIS SUBBIDTEKINFO', 
        'Admin', 
        '410804004', 
        'Admin Tekinfo Bid Tik', 
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

  // API Routes
  app.get('/api/units', isAdmin, async (req: any, res: any) => {
    try {
      let query = 'SELECT * FROM units';
      let params: any[] = [];

      // Role-based filtering for units list
      if (req.user.role !== 'superadmin') {
        query += ' WHERE LOWER(TRIM(nama)) = LOWER(TRIM(?))';
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

  app.get('/api/stats', isAdmin, async (req: any, res: any) => {
    try {
      let roleConditionPer = '';
      let roleConditionReq = '';
      let paramsPer: any[] = [];
      let paramsReq: any[] = [];

      if (req.user.role === 'user') {
        roleConditionPer = 'WHERE LOWER(TRIM(kesatuan)) = LOWER(TRIM(?)) AND is_deleted = 0';
        roleConditionReq = 'WHERE LOWER(TRIM(kesatuan)) = LOWER(TRIM(?)) AND is_deleted = 0';
        paramsPer.push(req.user.kesatuan || '');
        paramsReq.push(req.user.kesatuan || '');
      } else {
        roleConditionPer = 'WHERE is_deleted = 0';
        roleConditionReq = 'WHERE is_deleted = 0';
      }

      // MENDESAK requests
      const [urgentReq]: any = await pool.query(
        `SELECT COUNT(*) as c FROM reset_requests ${roleConditionReq} ${roleConditionReq ? 'AND' : 'WHERE'} prioritas = 'Mendesak' AND status != 'SELESAI'`,
        paramsReq
      );

      // DIPROSES requests
      const [processReq]: any = await pool.query(
        `SELECT COUNT(*) as c FROM reset_requests ${roleConditionReq} ${roleConditionReq ? 'AND' : 'WHERE'} status = 'DIPROSES'`,
        paramsReq
      );

      // MENUNGGU requests
      const [waitReq]: any = await pool.query(
        `SELECT COUNT(*) as c FROM reset_requests ${roleConditionReq} ${roleConditionReq ? 'AND' : 'WHERE'} status = 'MENUNGGU'`,
        paramsReq
      );

      // TOTAL requests
      const [totalReq]: any = await pool.query(
        `SELECT COUNT(*) as c FROM reset_requests ${roleConditionReq}`,
        paramsReq
      );

      // TOTAL personnel
      const [totalPer]: any = await pool.query(
        `SELECT COUNT(*) as c FROM personnel ${roleConditionPer}`,
        paramsPer
      );

      res.json({
        success: true,
        requests: {
          total: totalReq[0].c,
          urgent: urgentReq[0].c,
          processing: processReq[0].c,
          pending: waitReq[0].c
        },
        personnel: {
          total: totalPer[0].c
        }
      });
    } catch (e) {
      console.error('/api/stats error:', e);
      res.status(500).json({ success: false });
    }
  });

  app.get('/api/personnel', isAdmin, async (req: any, res: any) => {
    const page = parseInt(req.query.page || '1');
    const limit = parseInt(req.query.limit || '10');
    const offset = (page - 1) * limit;
    const search = req.query.search || '';
    const role = req.query.role;
    const kesatuan = req.query.kesatuan;

    let query = 'SELECT * FROM personnel';
    let countQuery = 'SELECT COUNT(*) as count FROM personnel';
    let params: any[] = [];
    let whereClauses: string[] = ['is_deleted = 0'];

    // Role-based filtering: 'user' role is strictly restricted to their own kesatuan
    // 'admin' and 'superadmin' can see all personnel
    if (req.user.role === 'user') {
      whereClauses.push('LOWER(TRIM(kesatuan)) = LOWER(TRIM(?))');
      params.push(req.user.kesatuan || '');
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
    
    res.json({
      data: rows,
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
        const hashedPassword = await bcrypt.hash(p.passwordPlain || 'pCtAi9T2221G', 10);
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
        'SELECT * FROM personnel WHERE LOWER(email) = ?', 
        [cleanEmail]
      );
      
      if (rows.length > 0) {
        const user = rows[0];
        const isMatch = await bcrypt.compare(cleanPassword, user.password);
        
        if (isMatch) {
          // Don't send password back to client
          const { password: _, ...userWithoutPassword } = user;
          
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
    const limit = parseInt(req.query.limit || '10');
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
      whereClauses.push('LOWER(TRIM(kesatuan)) = LOWER(TRIM(?))');
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
        kesatuanCell.value = { formula: `"${userKesatuan}"`, result: userKesatuan };

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

    let query = 'SELECT * FROM reset_requests';
    let params: any[] = [];
    let whereClauses: string[] = [];

    if (req.user.role !== 'superadmin') {
      whereClauses.push('LOWER(TRIM(kesatuan)) = LOWER(TRIM(?))');
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
      // Data isolation: check within kesatuan if not superadmin
      let query = 'SELECT nama FROM reset_requests WHERE nrp = ?';
      let params = [nrp];

      if (req.user.role !== 'superadmin') {
        query += ' AND LOWER(TRIM(kesatuan)) = LOWER(TRIM(?))';
        params.push(req.user.kesatuan);
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

  const optionalAuth = (req: any, res: any, next: any) => {
    const token = req.cookies.token;
    if (token) {
      try {
        const decoded: any = jwt.verify(token, JWT_SECRET);
        req.user = decoded;
      } catch (err) {}
    }
    next();
  };

  app.post('/api/requests', publicRequestLimiter, optionalAuth, upload.single('dokumen_kta_file'), async (req: any, res: any) => {
    if (req.user && req.user.role === 'admin') {
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
    
    // Enforce kesatuan for non-superadmins, if public, keep the submitted kesatuan
    const finalKesatuan = (req.user && req.user.role !== 'superadmin') ? req.user.kesatuan : (r.kesatuan || 'Polda Jatim');

    // Backend Guard: Reject if KESATUAN doesn't match user's kesatuan (for non-superadmin logged in users)
    if (req.user && req.user.role !== 'superadmin') {
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

      if (r.status === 'SELESAI' && r.reset_password) {
        // Hash for personnel table ONLY to maintain security there
        const hashedPassword = await bcrypt.hash(r.reset_password, 10);
        await pool.query('UPDATE personnel SET password = ? WHERE nrp = ?', [hashedPassword, r.nrp]);
        
        // storedPassword remains plaintext for reset_requests table as requested
      }

      await pool.query(`
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

  app.get('/api/logs', async (_req: any, res: any) => {
    try {
      const [rows]: any = await pool.query('SELECT * FROM logs ORDER BY waktu DESC');
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

  app.post('/api/logs', async (req: any, res: any) => {
    try {
      const log = req.body;
      const userNama = log.user?.nama || 'Unknown';
      const userRole = log.user?.role || 'Unknown';
      const ipAddress = req.headers['x-forwarded-for'] || req.socket.remoteAddress || log.ipAddress || 'Unknown';

      await pool.query(`
        INSERT INTO logs (id, waktu, user_nama, user_role, aktivitas, keterangan, ipAddress)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `, [log.id, log.waktu, userNama, userRole, log.aktivitas, log.keterangan, ipAddress]);
      res.json({ success: true });
    } catch (error) {
      console.error('Failed to create log:', error);
      res.status(500).json({ success: false, message: 'Gagal menyimpan log' });
    }
  });

  // OTP Logic
  app.post('/api/otp/request', publicRequestLimiter, async (req: any, res: any) => {
    const { nrp } = req.body;
    const [rows]: any = await pool.query('SELECT * FROM personnel WHERE nrp = ?', [nrp]);
    
    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'NRP tidak terdaftar' });
    }

    const user = rows[0];
    const otpCode = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + (5 * 60 * 1000); // 5 minutes

    await pool.query('INSERT INTO otp_codes (nrp, code, expiresAt) VALUES (?, ?, ?)', [nrp, otpCode, expiresAt]);
    
    try {
      if (user.email) {
        const mailOptions = {
          from: process.env.SMTP_USER || 'your-email@polda-jatim.go.id',
          to: user.email,
          subject: 'Kode Verifikasi Reset Password (OTP)',
          text: `Halo ${user.nama},\n\nKode verifikasi (OTP) Anda adalah: ${otpCode}\n\nKode ini berlaku selama 5 menit.\n\nJika Anda tidak merasa melakukan permintaan ini, silakan abaikan email ini.`
        };
        await transporter.sendMail(mailOptions);
        res.json({ success: true, message: 'OTP telah dikirim ke email Anda' });
      } else {
        console.log(`[SIMULASI OTP] Kode OTP untuk ${nrp} adalah: ${otpCode} (User tidak memiliki email)`);
        res.json({ success: true, message: 'OTP telah dikirim (Simulasi: Cek console server)' });
      }
    } catch (error) {
      console.error('Failed to send OTP email:', error);
      res.json({ success: true, message: 'OTP gagal dikirim via email, silakan hubungi admin. (Simulasi: Cek console server)' });
      console.log(`[SIMULASI OTP] Kode OTP untuk ${nrp} adalah: ${otpCode}`);
    }
  });

  app.post('/api/otp/verify', async (req: any, res: any) => {
    const { nrp, code } = req.body;
    const [rows]: any = await pool.query(
      'SELECT * FROM otp_codes WHERE nrp = ? AND code = ? AND isUsed = 0 AND expiresAt > ?',
      [nrp, code, Date.now()]
    );

    if (rows.length > 0) {
      const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
      await pool.query('UPDATE otp_codes SET isUsed = 1, token = ? WHERE id = ?', [token, rows[0].id]);
      res.json({ success: true, token });
    } else {
      res.status(400).json({ success: false, message: 'Kode OTP salah atau sudah kadaluarsa' });
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
