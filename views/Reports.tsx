import React, { useMemo, useState, useEffect } from 'react';
import * as XLSX from 'xlsx';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell
} from 'recharts';
import { ResetRequest, RequestStatus, SiteSettings, UserRole, Personnel } from '../types';

interface ReportsProps {
  requests: ResetRequest[];
  showToast?: (msg: string) => void;
  siteSettings?: SiteSettings;
  currentUser: Personnel;
}

const Reports: React.FC<ReportsProps> = ({ requests, showToast, siteSettings, currentUser }) => {
  const isDarkMode = siteSettings?.darkMode;
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isMobile = windowWidth < 768;

  const filteredRequests = useMemo(() => {
    return requests.filter(req => {
      // Filter by role & kesatuan: Only 'user' role is restricted to their own kesatuan
      // 'admin' and 'superadmin' can see all requests
      if (currentUser.role === UserRole.USER && req.kesatuan !== currentUser.kesatuan) {
        return false;
      }

      let matchesDate = true;
      const reqDate = new Date(req.createdAt).setHours(0,0,0,0);
      if (startDate) {
        const start = new Date(startDate).setHours(0,0,0,0);
        if (reqDate < start) matchesDate = false;
      }
      if (endDate) {
        const end = new Date(endDate).setHours(23,59,59,999);
        if (reqDate > end) matchesDate = false;
      }
      return matchesDate;
    });
  }, [requests, startDate, endDate]);

  const barData = useMemo(() => {
    const days = ['SEN', 'SEL', 'RAB', 'KAM', 'JUM', 'SAB', 'MIN'];
    return days.map((day, index) => ({
      name: day,
      permintaan: filteredRequests.filter(r => (new Date(r.createdAt).getDay() || 7) === (index + 1)).length
    }));
  }, [filteredRequests]);

  const pieData = useMemo(() => {
    const finished = filteredRequests.filter(r => r.status === RequestStatus.SELESAI).length;
    const rejected = filteredRequests.filter(r => r.status === RequestStatus.DITOLAK).length;
    const pending = filteredRequests.filter(r => r.status !== RequestStatus.SELESAI && r.status !== RequestStatus.DITOLAK).length;
    const total = filteredRequests.length;

    const finishedPercent = total > 0 ? Math.round((finished / total) * 100) : 0;
    const rejectedPercent = total > 0 ? Math.round((rejected / total) * 100) : 0;
    const pendingPercent = total > 0 ? Math.round((pending / total) * 100) : 0;

    return {
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
  }, [filteredRequests]);

  const polresSummary = useMemo(() => {
    const kesatuanMap: Record<string, any> = {};
    
    filteredRequests.forEach(req => {
      if (!kesatuanMap[req.kesatuan]) {
        kesatuanMap[req.kesatuan] = {
          name: req.kesatuan,
          total: 0,
          backlog: 0,
          selesai: 0,
          ditolak: 0,
        };
      }
      kesatuanMap[req.kesatuan].total++;
      if (req.status === RequestStatus.SELESAI) {
        kesatuanMap[req.kesatuan].selesai++;
      } else if (req.status === RequestStatus.DITOLAK) {
        kesatuanMap[req.kesatuan].ditolak++;
      } else {
        kesatuanMap[req.kesatuan].backlog++;
      }
    });

    return Object.values(kesatuanMap).map(item => ({
      ...item,
      ratio: item.total > 0 ? ((item.selesai / item.total) * 100).toFixed(1) : "0",
      repeat: "2.4", 
      avg: "1.2"     
    }));
  }, [filteredRequests]);

  const exportCSV = () => {
    const headers = ['Kesatuan', 'Total', 'Backlog', 'Selesai', 'Ditolak', 'Rasio %'];
    const rows = polresSummary.map(p => [p.name, p.total, p.backlog, p.selesai, p.ditolak, p.ratio]);
    
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const csvContent = XLSX.utils.sheet_to_csv(ws);
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `rekap_laporan_${Date.now()}.csv`;
    link.click();
    showToast?.('Laporan diekspor ke CSV');
  };

  const exportExcel = () => {
    const headers = ['Kesatuan', 'Total', 'Backlog', 'Selesai', 'Ditolak', 'Rasio %'];
    const rows = polresSummary.map(p => [p.name, p.total, p.backlog, p.selesai, p.ditolak, p.ratio]);
    
    const ws = XLSX.utils.aoa_to_sheet([headers, ...rows]);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Rekap Laporan");
    
    // Simpan dalam format .xls (BIFF8)
    XLSX.writeFile(wb, `rekap_laporan_${Date.now()}.xls`, { bookType: 'xls' });
    
    showToast?.('Laporan diekspor ke Excel (.xls)');
  };

  const exportPDF = () => {
    window.print();
    showToast?.('Membuka dialog cetak PDF');
  };

  return (
    <main className="p-4 md:p-10 space-y-6 md:space-y-8 max-w-[1600px] mx-auto print:p-0">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 print:hidden">
        <div>
          <h1 className={`text-2xl md:text-3xl font-extrabold tracking-tight ${isDarkMode ? 'text-white' : 'text-[#1e293b]'}`}>Laporan Rekapitulasi</h1>
          <p className="text-xs md:text-sm text-slate-500 font-medium mt-1">Visualisasi data dan export laporan bulanan sistem reset password.</p>
        </div>
        <div className="flex flex-col sm:flex-row sm:items-end gap-4">
          <div className="flex items-center gap-3">
            <div className="flex flex-col gap-1 flex-1 sm:flex-none">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Mulai</span>
              <input 
                type="date" 
                className={`w-full sm:w-auto px-4 py-2 border rounded-xl text-[10px] font-black outline-none uppercase ${isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-white border-slate-200 text-slate-600'}`} 
                value={startDate} 
                onChange={(e) => setStartDate(e.target.value)} 
              />
            </div>
            <div className="flex flex-col gap-1 flex-1 sm:flex-none">
              <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest ml-1">Selesai</span>
              <input 
                type="date" 
                className={`w-full sm:w-auto px-4 py-2 border rounded-xl text-[10px] font-black outline-none uppercase ${isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-white border-slate-200 text-slate-600'}`} 
                value={endDate} 
                onChange={(e) => setEndDate(e.target.value)} 
              />
            </div>
            { (startDate || endDate) && (
              <button 
                onClick={() => { setStartDate(''); setEndDate(''); }}
                className="mt-4 p-2 text-slate-400 hover:text-rose-500 transition-colors"
                title="Reset Filter"
              >
                <span className="material-symbols-outlined text-base">restart_alt</span>
              </button>
            )}
          </div>
          <div className="grid grid-cols-3 sm:flex items-center gap-2 w-full sm:w-auto">
            <button onClick={exportExcel} className={`flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg text-[10px] md:text-sm font-bold hover:bg-blue-700 transition-colors shadow-lg ${isDarkMode ? 'shadow-none' : 'shadow-blue-100'}`}>
              <span className="material-symbols-outlined text-sm md:text-base">table_view</span>
              XLS
            </button>
            <button onClick={exportCSV} className={`flex items-center justify-center gap-2 px-3 py-2 border rounded-lg text-[10px] md:text-sm font-bold transition-colors ${
              isDarkMode ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20' : 'bg-emerald-50 border-emerald-100 text-emerald-700 hover:bg-emerald-100'
            }`}>
              <span className="material-symbols-outlined text-sm md:text-base">download</span>
              CSV
            </button>
            <button onClick={exportPDF} className={`flex items-center justify-center gap-2 px-3 py-2 border rounded-lg text-[10px] md:text-sm font-bold transition-colors ${
              isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-700' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}>
              <span className="material-symbols-outlined text-sm md:text-base">picture_as_pdf</span>
              PDF
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 print:hidden">
        <div className={`lg:col-span-2 p-4 md:p-6 rounded-2xl shadow-sm border transition-colors duration-300 ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100'
        }`}>
          <div className="flex items-center justify-between mb-6 md:mb-8">
            <h3 className={`font-black text-xs md:text-sm uppercase tracking-wider ${isDarkMode ? 'text-slate-300' : 'text-slate-800'}`}>Tren Permintaan Reset</h3>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-blue-500"></span>
              <span className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">Permintaan</span>
            </div>
          </div>
          
          <div className="h-64 md:h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barData} margin={{ top: 20, right: 10, left: -30, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDarkMode ? '#1e293b' : '#f1f5f9'} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 9, fontWeight: 800, fill: isDarkMode ? '#475569' : '#94a3b8' }} dy={10} />
                <YAxis hide />
                <Tooltip cursor={{ fill: isDarkMode ? '#1e293b' : '#f8fafc' }} contentStyle={{ backgroundColor: isDarkMode ? '#0f172a' : '#ffffff', borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }} itemStyle={{ fontWeight: 800, fontSize: '11px', color: '#0ea5e9' }} />
                <Bar dataKey="permintaan" fill={isDarkMode ? '#334155' : '#cbd5e1'} radius={[4, 4, 0, 0]} barSize={isMobile ? 30 : 60}>
                  {barData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={index === 2 ? '#0ea5e9' : (isDarkMode ? '#334155' : '#cbd5e1')} className="hover:fill-sky-500 transition-colors cursor-pointer" />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className={`p-4 md:p-6 rounded-2xl shadow-sm border flex flex-col transition-colors duration-300 ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100'
        }`}>
          <h3 className={`font-black text-xs md:text-sm uppercase tracking-wider mb-6 md:mb-8 ${isDarkMode ? 'text-slate-300' : 'text-slate-800'}`}>Distribusi Status</h3>
          <div className="relative flex-1 flex items-center justify-center min-h-[200px] md:min-h-[250px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieData.chart} cx="50%" cy="50%" innerRadius={isMobile ? 60 : 70} outerRadius={isMobile ? 85 : 95} paddingAngle={5} dataKey="value">
                  {pieData.chart.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ backgroundColor: isDarkMode ? '#0f172a' : '#ffffff', borderRadius: '12px', border: 'none' }} />
              </PieChart>
            </ResponsiveContainer>
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span className={`text-3xl md:text-4xl font-black leading-none ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>{pieData.total}</span>
              <span className="text-[9px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest mt-1">Total</span>
            </div>
          </div>
        </div>
      </div>

      <div className="space-y-4 print:space-y-0">
        <h3 className={`text-base md:text-lg font-black print:mb-4 ${isDarkMode ? 'text-slate-200' : 'text-slate-800'}`}>
          {currentUser.role === UserRole.SUPERADMIN ? 'Ringkasan per Polres' : `Ringkasan ${currentUser.kesatuan}`}
        </h3>
        
        {/* TABLE VIEW (DESKTOP) */}
        <div className={`hidden md:block rounded-2xl shadow-sm border overflow-hidden print:border-none print:shadow-none transition-colors duration-300 ${
          isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100'
        }`}>
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className={`border-b transition-colors ${isDarkMode ? 'bg-slate-800/50 border-slate-800' : 'bg-slate-50/50 border-slate-100'}`}>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest">Kesatuan / Polres</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Total Request</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Backlog</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Selesai</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Ditolak</th>
                  <th className="px-6 py-4 text-[10px] font-black text-slate-400 uppercase tracking-widest text-center">Rasio %</th>
                </tr>
              </thead>
              <tbody className={`divide-y transition-colors ${isDarkMode ? 'divide-slate-800' : 'divide-slate-50'}`}>
                {polresSummary.map((item, idx) => (
                  <tr key={idx} className={`transition-colors ${isDarkMode ? 'hover:bg-slate-800/40' : 'hover:bg-slate-50/50'}`}>
                    <td className={`px-6 py-4 text-sm font-black ${isDarkMode ? 'text-slate-300' : 'text-slate-700'}`}>{item.name}</td>
                    <td className={`px-6 py-4 text-sm font-bold text-center ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>{item.total}</td>
                    <td className={`px-6 py-4 text-sm font-bold text-center ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>{item.backlog}</td>
                    <td className={`px-6 py-4 text-sm font-bold text-center ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>{item.selesai}</td>
                    <td className={`px-6 py-4 text-sm font-bold text-center ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>{item.ditolak}</td>
                    <td className="px-6 py-4 text-center">
                      <span className="text-xs font-black text-emerald-600">{item.ratio}%</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* CARD VIEW (MOBILE) */}
        <div className="md:hidden space-y-4">
          {polresSummary.map((item, idx) => (
            <div 
              key={idx}
              className={`p-4 rounded-2xl border shadow-sm space-y-4 transition-colors ${
                isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100'
              }`}
            >
              <div className="flex justify-between items-center">
                <div className={`text-sm font-black ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>
                  {item.name}
                </div>
                <div className="px-2 py-1 bg-emerald-50 dark:bg-emerald-500/10 rounded-lg">
                  <span className="text-[10px] font-black text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">
                    {item.ratio}% Rasio
                  </span>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-2">
                <div className="flex flex-col items-center p-2 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                  <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Total</span>
                  <span className={`text-sm font-black ${isDarkMode ? 'text-slate-200' : 'text-slate-700'}`}>{item.total}</span>
                </div>
                <div className="flex flex-col items-center p-2 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                  <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Backlog</span>
                  <span className={`text-sm font-black ${isDarkMode ? 'text-amber-500' : 'text-amber-600'}`}>{item.backlog}</span>
                </div>
                <div className="flex flex-col items-center p-2 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                  <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Selesai</span>
                  <span className={`text-sm font-black ${isDarkMode ? 'text-emerald-500' : 'text-emerald-600'}`}>{item.selesai}</span>
                </div>
                <div className="flex flex-col items-center p-2 rounded-xl bg-slate-50 dark:bg-slate-800/50">
                  <span className="text-[8px] font-black text-slate-400 uppercase tracking-widest mb-1">Ditolak</span>
                  <span className={`text-sm font-black ${isDarkMode ? 'text-rose-500' : 'text-rose-600'}`}>{item.ditolak}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
      <style>{`
        @media print {
          body * { visibility: hidden; }
          .print\:p-0, .print\:p-0 * { visibility: visible; }
          .print\:p-0 { position: absolute; left: 0; top: 0; width: 100%; }
          .print\:hidden { display: none !important; }
          .print\:border-none { border: none !important; }
          .print\:shadow-none { box-shadow: none !important; }
        }
      `}</style>
    </main>
  );
};

export default Reports;