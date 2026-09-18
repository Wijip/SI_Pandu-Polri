
import React, { useState, useMemo } from 'react';
import * as XLSX from 'xlsx';
import { LogEntry, SiteSettings } from '../types';

interface LogsProps {
  logs: LogEntry[];
  showToast?: (msg: string) => void;
  siteSettings?: SiteSettings;
}

const Logs: React.FC<LogsProps> = ({ logs, showToast, siteSettings }) => {
  const isDarkMode = siteSettings?.darkMode;
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('Semua');
  
  // State untuk filter tanggal
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);

  const filteredLogs = useMemo(() => {
    if (!Array.isArray(logs)) return [];
    
    return logs.filter(log => {
      if (!log || !log.user) return false;

      const nama = log.user.nama || '';
      const aktivitas = log.aktivitas || '';
      const keterangan = log.keterangan || '';

      const matchesSearch = 
        nama.toLowerCase().includes(searchTerm.toLowerCase()) ||
        aktivitas.toLowerCase().includes(searchTerm.toLowerCase()) ||
        keterangan.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesType = typeFilter === 'Semua' || aktivitas === typeFilter;
      
      let matchesDate = true;
      if (startDate || endDate) {
        const logTime = log.waktu;
        if (startDate) {
          const start = new Date(startDate).setHours(0, 0, 0, 0);
          if (logTime < start) matchesDate = false;
        }
        if (endDate) {
          const end = new Date(endDate).setHours(23, 59, 59, 999);
          if (logTime > end) matchesDate = false;
        }
      }
      
      return matchesSearch && matchesType && matchesDate;
    }).sort((a, b) => (b.waktu || 0) - (a.waktu || 0));
  }, [logs, searchTerm, typeFilter, startDate, endDate]);

  const exportCSV = () => {
    const headers = ['Waktu', 'User', 'Role', 'Aktivitas', 'Keterangan', 'IP Address'];
    const rows = filteredLogs.map(l => [
      l.waktu ? new Date(l.waktu).toLocaleString('id-ID') : '-',
      l.user?.nama || '-',
      l.user?.role || '-',
      l.aktivitas || '-',
      l.keterangan || '-',
      l.ipAddress || '-'
    ]);
    
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const csvContent = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `log_aktivitas_${Date.now()}.csv`;
    link.click();
    showToast?.('Log diekspor ke CSV');
  };

  const exportExcel = () => {
    const headers = ['Waktu', 'User', 'Role', 'Aktivitas', 'Keterangan', 'IP Address'];
    const rows = filteredLogs.map(l => [
      l.waktu ? new Date(l.waktu).toLocaleString('id-ID') : '-',
      l.user?.nama || '-',
      l.user?.role || '-',
      l.aktivitas || '-',
      l.keterangan || '-',
      l.ipAddress || '-'
    ]);
    
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Sistem Log");
    XLSX.writeFile(wb, `log_aktivitas_${Date.now()}.xls`, { bookType: 'xls' });
    showToast?.('Log diekspor ke Excel (.xls)');
  };

  return (
    <main className="p-4 md:p-10 space-y-6 md:space-y-8 max-w-[1600px] mx-auto print:p-0">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 print:hidden">
        <div>
          <h1 className={`text-2xl md:text-3xl font-extrabold tracking-tight ${isDarkMode ? 'text-white' : 'text-[#1e293b]'}`}>Log Aktivitas</h1>
          <p className="text-xs md:text-sm text-slate-500 font-medium mt-1">Audit aktivitas sistem dan riwayat tindakan administrator</p>
        </div>
        <div className="flex flex-wrap items-center gap-2 md:gap-4">
          <div className="grid grid-cols-3 gap-2 w-full sm:w-auto">
            <button onClick={exportCSV} className={`flex items-center justify-center gap-2 px-3 md:px-4 py-2 border rounded-lg text-xs md:text-sm font-bold transition-colors shadow-sm ${
              isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}>
              <span className="material-symbols-outlined text-blue-600 text-lg md:text-xl">description</span>
              CSV
            </button>
            <button onClick={exportExcel} className={`flex items-center justify-center gap-2 px-3 md:px-4 py-2 border rounded-lg text-xs md:text-sm font-bold transition-colors shadow-sm ${
              isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}>
              <span className="material-symbols-outlined text-emerald-600 text-lg md:text-xl">table_view</span>
              XLS
            </button>
            <button onClick={() => window.print()} className={`flex items-center justify-center gap-2 px-3 md:px-4 py-2 border rounded-lg text-xs md:text-sm font-bold transition-colors shadow-sm ${
              isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}>
              <span className="material-symbols-outlined text-rose-600 text-lg md:text-xl">picture_as_pdf</span>
              PDF
            </button>
          </div>
        </div>
      </div>

      {/* FILTER PANEL LOG */}
      <div className={`p-3 md:p-4 rounded-2xl shadow-sm border flex flex-col lg:flex-row items-center gap-3 print:hidden transition-colors duration-300 ${
        isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100'
      }`}>
        <div className="flex items-center gap-2 w-full">
          <div className="relative flex-1">
            <span className="material-symbols-outlined absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 text-xl">search</span>
            <input 
              type="text" 
              placeholder="Cari nama, tipe, keterangan..." 
              className={`w-full pl-12 pr-4 py-2.5 border rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500/10 text-sm font-bold transition-colors ${
                isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-700'
              }`}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
          </div>
          <button 
            onClick={() => setIsFilterModalOpen(true)}
            className={`lg:hidden p-2.5 border rounded-xl transition-colors ${
              isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-white border-slate-200 text-slate-600'
            }`}
          >
            <span className="material-symbols-outlined">filter_list</span>
          </button>
        </div>
        
        <div className="hidden lg:flex flex-wrap items-center gap-2 w-full lg:w-auto">
          <select 
            className={`px-4 py-2.5 border rounded-xl text-sm font-bold focus:outline-none min-w-[150px] transition-colors ${
              isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-600'
            }`}
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            <option value="Semua">Tipe: Semua</option>
            <option value="Reset Password">Reset Password</option>
            <option value="Login">Login</option>
            <option value="Sistem">Sistem</option>
          </select>

          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-colors ${
            isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'
          }`}>
            <span className="text-[10px] font-black text-slate-400 uppercase">Dari:</span>
            <input 
              type="date" 
              className={`bg-transparent border-none text-xs font-bold outline-none ${isDarkMode ? 'text-white' : 'text-slate-600'}`}
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </div>

          <div className={`flex items-center gap-2 px-3 py-1.5 rounded-xl border transition-colors ${
            isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'
          }`}>
            <span className="text-[10px] font-black text-slate-400 uppercase">Hingga:</span>
            <input 
              type="date" 
              className={`bg-transparent border-none text-xs font-bold outline-none ${isDarkMode ? 'text-white' : 'text-slate-600'}`}
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </div>

          <button 
            onClick={() => { setSearchTerm(''); setTypeFilter('Semua'); setStartDate(''); setEndDate(''); }}
            className={`px-6 py-2.5 border rounded-xl font-bold text-sm transition-all ${
              isDarkMode ? 'border-slate-700 text-slate-400 hover:bg-slate-800' : 'border-slate-200 text-slate-500 hover:bg-slate-50'
            }`}
          >
            Reset
          </button>
        </div>
      </div>

      {/* TABLE VIEW (DESKTOP) */}
      <div className={`hidden md:block rounded-2xl shadow-sm border overflow-hidden print:border-none print:shadow-none transition-colors duration-300 ${
        isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100'
      }`}>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className={`border-b transition-colors ${isDarkMode ? 'bg-slate-800/50 border-slate-800' : 'bg-slate-50/50 border-slate-100'}`}>
                <th className="px-6 py-4 text-[11px] font-black text-slate-400 uppercase tracking-widest">Waktu</th>
                <th className="px-6 py-4 text-[11px] font-black text-slate-400 uppercase tracking-widest">Admin/User</th>
                <th className="px-6 py-4 text-[11px] font-black text-slate-400 uppercase tracking-widest text-center">Aktivitas</th>
                <th className="px-6 py-4 text-[11px] font-black text-slate-400 uppercase tracking-widest">Keterangan</th>
                <th className="px-6 py-4 text-[11px] font-black text-slate-400 uppercase tracking-widest">IP Address</th>
              </tr>
            </thead>
            <tbody className={`divide-y transition-colors ${isDarkMode ? 'divide-slate-800' : 'divide-slate-50'}`}>
              {filteredLogs.map((log) => (
                <tr key={log.id} className={`transition-colors ${isDarkMode ? 'hover:bg-slate-800/40' : 'hover:bg-slate-50/50'}`}>
                  <td className="px-6 py-5 text-nowrap">
                    <div className={`text-sm font-bold ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>{log.waktu ? new Date(log.waktu).toLocaleDateString('id-ID') : '-'}</div>
                    <div className="text-[10px] text-slate-400 font-bold">{log.waktu ? new Date(log.waktu).toLocaleTimeString('id-ID') : '-'}</div>
                  </td>
                  <td className="px-6 py-5">
                    <div className={`text-sm font-black ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>{log.user?.nama || 'Unknown'}</div>
                    <div className="text-[10px] text-slate-400 font-bold">{log.user?.role || '-'}</div>
                  </td>
                  <td className="px-6 py-5 text-center">
                    <span className={`inline-flex px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider ${
                      log.aktivitas === 'Reset Password' ? (isDarkMode ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-50 text-emerald-600') :
                      log.aktivitas === 'Login' ? (isDarkMode ? 'bg-blue-500/10 text-blue-400' : 'bg-blue-50 text-blue-600') :
                      log.aktivitas === 'Sistem' ? (isDarkMode ? 'bg-slate-800 text-slate-400' : 'bg-slate-100 text-slate-600') : (isDarkMode ? 'bg-amber-500/10 text-amber-400' : 'bg-amber-50 text-amber-600')
                    }`}>
                      {log.aktivitas || 'Lainnya'}
                    </span>
                  </td>
                  <td className={`px-6 py-5 text-sm font-bold ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>{log.keterangan || '-'}</td>
                  <td className={`px-6 py-5 text-sm font-bold font-mono ${isDarkMode ? 'text-slate-500' : 'text-slate-400'}`}>{log.ipAddress || '-'}</td>
                </tr>
              ))}
              {filteredLogs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center text-slate-400 italic">Data log tidak ditemukan untuk filter ini.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* CARD VIEW (MOBILE) */}
      <div className="md:hidden space-y-4">
        {filteredLogs.map((log) => (
          <div 
            key={log.id}
            className={`p-4 rounded-2xl border shadow-sm space-y-3 transition-colors ${
              isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100'
            }`}
          >
            <div className="flex justify-between items-start">
              <div className="space-y-0.5">
                <div className={`text-sm font-black ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
                  {log.user?.nama || 'Unknown'}
                </div>
                <div className="text-[10px] text-slate-400 font-bold uppercase tracking-wider">
                  {log.user?.role || '-'} • {log.ipAddress || '-'}
                </div>
              </div>
              <span className={`px-2.5 py-1 rounded-full text-[9px] font-black uppercase tracking-wider ${
                log.aktivitas === 'Reset Password' ? (isDarkMode ? 'bg-emerald-500/10 text-emerald-400' : 'bg-emerald-50 text-emerald-600') :
                log.aktivitas === 'Login' ? (isDarkMode ? 'bg-blue-500/10 text-blue-400' : 'bg-blue-50 text-blue-600') :
                log.aktivitas === 'Sistem' ? (isDarkMode ? 'bg-slate-800 text-slate-400' : 'bg-slate-100 text-slate-600') : (isDarkMode ? 'bg-amber-500/10 text-amber-400' : 'bg-amber-50 text-amber-600')
              }`}>
                {log.aktivitas || 'Lainnya'}
              </span>
            </div>
            
            <div className={`text-xs font-bold leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>
              {log.keterangan || '-'}
            </div>

            <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-1.5 text-slate-400">
                <span className="material-symbols-outlined text-sm">schedule</span>
                <span className="text-[10px] font-bold">
                  {log.waktu ? new Date(log.waktu).toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' }) : '-'}
                </span>
              </div>
            </div>
          </div>
        ))}
        {filteredLogs.length === 0 && (
          <div className="py-12 text-center text-slate-400 italic text-sm">Data log tidak ditemukan.</div>
        )}
      </div>

      {/* FILTER MODAL (MOBILE) */}
      {isFilterModalOpen && (
        <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm">
          <div className={`w-full max-w-lg rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden transition-colors ${
            isDarkMode ? 'bg-slate-900' : 'bg-white'
          }`}>
            <div className="p-6 space-y-6">
              <div className="flex items-center justify-between">
                <h3 className={`text-xl font-black ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>Filter Log</h3>
                <button onClick={() => setIsFilterModalOpen(false)} className="p-2 text-slate-400 hover:text-rose-500 transition-colors">
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Tipe Aktivitas</label>
                  <select 
                    className={`w-full px-4 py-3 border rounded-xl text-sm font-bold focus:outline-none transition-colors ${
                      isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-600'
                    }`}
                    value={typeFilter}
                    onChange={(e) => setTypeFilter(e.target.value)}
                  >
                    <option value="Semua">Semua Tipe</option>
                    <option value="Reset Password">Reset Password</option>
                    <option value="Login">Login</option>
                    <option value="Sistem">Sistem</option>
                  </select>
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Dari Tanggal</label>
                    <input 
                      type="date" 
                      className={`w-full px-4 py-3 border rounded-xl text-sm font-bold focus:outline-none transition-colors ${
                        isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-600'
                      }`}
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-slate-400 uppercase tracking-widest ml-1">Hingga Tanggal</label>
                    <input 
                      type="date" 
                      className={`w-full px-4 py-3 border rounded-xl text-sm font-bold focus:outline-none transition-colors ${
                        isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-600'
                      }`}
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                    />
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-4">
                <button 
                  onClick={() => { setSearchTerm(''); setTypeFilter('Semua'); setStartDate(''); setEndDate(''); }}
                  className={`flex-1 py-3.5 rounded-xl font-bold text-sm transition-all ${
                    isDarkMode ? 'bg-slate-800 text-slate-400 hover:bg-slate-700' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
                  }`}
                >
                  Reset
                </button>
                <button 
                  onClick={() => setIsFilterModalOpen(false)}
                  className="flex-1 py-3.5 bg-blue-600 text-white rounded-xl font-bold text-sm hover:bg-blue-700 transition-all shadow-lg shadow-blue-500/20"
                >
                  Terapkan
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};

export default Logs;
