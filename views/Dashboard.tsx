
import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  AreaChart,
  Area,
  XAxis,
  YAxis
} from 'recharts';
import { ResetRequest, Personnel, RequestStatus, UserRole, SiteSettings } from '../types';

interface DashboardProps {
  requests: ResetRequest[];
  personnel: Personnel[];
  showToast: (msg: string) => void;
  currentUser: Personnel;
  siteSettings: SiteSettings;
}

const Dashboard: React.FC<DashboardProps> = ({ requests, personnel, currentUser, siteSettings }) => {
  const isSuperAdmin = currentUser.role === UserRole.SUPERADMIN;
  const isAdminPolres = currentUser.role === UserRole.ADMIN;
  const isDarkMode = siteSettings.darkMode;
  const [chartRange, setChartRange] = useState<'7' | '30'>('7');

  const stats = useMemo(() => {
    // Filter data berdasarkan role
    const relevantPersonnel = (isSuperAdmin || isAdminPolres) ? personnel : personnel.filter(p => p.kesatuan === currentUser.kesatuan);
    const relevantRequests = (isSuperAdmin || isAdminPolres) ? requests : requests.filter(r => r.kesatuan === currentUser.kesatuan);

    const active = relevantRequests.filter(r => r.status !== RequestStatus.SELESAI && r.status !== RequestStatus.DITOLAK).length;
    const completed = relevantRequests.filter(r => r.status === RequestStatus.SELESAI).length;
    const rejected = relevantRequests.filter(r => r.status === RequestStatus.DITOLAK).length;
    const pending = relevantRequests.filter(r => r.status === RequestStatus.MENUNGGU).length;
    const processing = relevantRequests.filter(r => r.status === RequestStatus.DIPROSES).length;

    return {
      totalUsers: relevantPersonnel.length,
      activeRequests: active,
      completedRequests: completed,
      rejectedRequests: rejected,
      pendingRequests: pending,
      processingRequests: processing,
      labelContext: (isSuperAdmin || isAdminPolres) ? 'Seluruh Jatim' : `Unit ${currentUser.kesatuan}`
    };
  }, [requests, personnel, currentUser, isSuperAdmin, isAdminPolres]);

  const chartData = useMemo(() => {
    const relevantRequests = (isSuperAdmin || isAdminPolres) ? requests : requests.filter(r => r.kesatuan === currentUser.kesatuan);
    const rangeDays = parseInt(chartRange);
    
    const daysArray = Array.from({ length: rangeDays }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (rangeDays - 1 - i));
      return d;
    });

    const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];

    return daysArray.map(date => {
      const dayStart = new Date(date.setHours(0, 0, 0, 0)).getTime();
      const dayEnd = new Date(date.setHours(23, 59, 59, 999)).getTime();
      
      const count = relevantRequests.filter(r => {
        const createdAt = r.createdAt || 0;
        return createdAt >= dayStart && createdAt <= dayEnd;
      }).length;

      return {
        name: rangeDays > 7 ? date.toLocaleDateString('id-ID', { day: 'numeric', month: 'short' }) : dayNames[date.getDay()],
        permintaan: count,
        fullDate: date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
      };
    });
  }, [requests, isSuperAdmin, isAdminPolres, currentUser.kesatuan, chartRange]);

  const recentRequests = useMemo(() => {
    const relevant = (isSuperAdmin || isAdminPolres) ? requests : requests.filter(r => r.kesatuan === currentUser.kesatuan);
    return relevant.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).slice(0, 5);
  }, [requests, isSuperAdmin, isAdminPolres, currentUser.kesatuan]);

  return (
    <motion.main 
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="p-4 md:p-10 space-y-6 md:space-y-8 transition-colors duration-300"
    >
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div>
          <span className="text-sky-600 font-black text-[10px] md:text-xs uppercase tracking-[0.2em]">Monitoring Panel</span>
          <h1 className={`text-2xl md:text-3xl font-black tracking-tight mt-1 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Dashboard {isSuperAdmin ? 'Super Admin' : 'Admin'}</h1>
          <p className="text-[10px] md:text-sm text-slate-500 font-medium mt-1">Cakupan Data: <span className={`${isDarkMode ? 'text-slate-300' : 'text-slate-900'} font-bold`}>{stats.labelContext}</span></p>
        </div>
        <div className={`px-3 py-1.5 md:px-4 md:py-2 rounded-xl md:rounded-2xl border shadow-sm flex items-center gap-2 md:gap-3 w-fit ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100'}`}>
          <div className="w-1.5 h-1.5 md:w-2 md:h-2 rounded-full bg-emerald-500 animate-pulse"></div>
          <span className={`text-[10px] md:text-xs font-bold ${isDarkMode ? 'text-slate-400' : 'text-slate-600'}`}>Terhubung ke Database</span>
        </div>
      </div>

      <section className="grid grid-cols-2 lg:grid-cols-5 gap-3 md:gap-6">
        {[
          { label: 'Total Anggota', value: stats.totalUsers, trend: stats.labelContext, icon: 'groups', color: 'indigo', link: '/personnel' },
          { label: 'Menunggu', value: stats.pendingRequests, trend: 'Butuh Verifikasi', icon: 'hourglass_empty', color: 'amber', link: '/requests' },
          { label: 'Diproses', value: stats.processingRequests, trend: 'Sedang Dikerjakan', icon: 'sync', color: 'blue', link: '/requests' },
          { label: 'Selesai', value: stats.completedRequests, trend: 'Terselesaikan', icon: 'verified', color: 'emerald', link: '/requests' },
          { label: 'Ditolak', value: stats.rejectedRequests, trend: 'Tidak Valid', icon: 'cancel', color: 'rose', link: '/requests' }
        ].map((stat, idx) => (
          <motion.div
            key={idx}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: idx * 0.1 }}
            className={idx === 4 ? 'col-span-2 lg:col-span-1' : ''}
          >
            <Link to={stat.link} className={`rounded-2xl md:rounded-[2rem] p-4 md:p-6 shadow-sm border hover:shadow-xl hover:-translate-y-1 transition-all duration-300 h-full block ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-50'}`}>
              <div className="flex items-start justify-between mb-3 md:mb-4">
                <div className={`w-10 h-10 md:w-14 md:h-14 rounded-xl md:rounded-2xl flex items-center justify-center ${isDarkMode ? `bg-${stat.color}-500/10` : `bg-${stat.color}-50`}`}>
                  <span className={`material-symbols-outlined text-${stat.color}-600 text-2xl md:text-3xl`}>{stat.icon}</span>
                </div>
              </div>
              <div className="text-[8px] md:text-[10px] font-black text-slate-400 uppercase tracking-widest">{stat.label}</div>
              <div className={`text-xl md:text-3xl font-black mt-1 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{stat.value}</div>
              <div className={`text-[8px] md:text-[10px] font-bold mt-2 inline-block px-2 py-1 rounded-lg ${isDarkMode ? `bg-${stat.color}-500/20 text-${stat.color}-400` : `bg-${stat.color}-50 text-${stat.color}-600`}`}>
                {stat.trend}
              </div>
            </Link>
          </motion.div>
        ))}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 md:gap-8">
        <div className={`lg:col-span-2 rounded-3xl md:rounded-[2.5rem] p-5 md:p-8 shadow-sm border ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-50'}`}>
          <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 md:mb-10 gap-4">
            <div>
              <h3 className={`font-black text-base md:text-lg ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Grafik Aktivitas</h3>
              <p className="text-[10px] text-slate-400 font-bold uppercase tracking-wider mt-1">Statistik Permintaan di {stats.labelContext}</p>
            </div>
            <div className="flex items-center gap-2">
              <select 
                value={chartRange}
                onChange={(e) => setChartRange(e.target.value as '7' | '30')}
                className={`text-[10px] font-black uppercase tracking-widest px-3 py-1.5 rounded-xl border focus:outline-none transition-all w-full md:w-auto ${
                  isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-300' : 'bg-slate-50 border-slate-100 text-slate-600'
                }`}
              >
                <option value="7">7 Hari</option>
                <option value="30">30 Hari</option>
              </select>
            </div>
          </div>

          <div className="h-64 md:h-80 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData}>
                <defs>
                  <linearGradient id="colorUsage" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#0ea5e9" stopOpacity={0.3}/>
                    <stop offset="95%" stopColor="#0ea5e9" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={isDarkMode ? "#1e293b" : "#f1f5f9"} />
                <XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fontSize: 10, fontWeight: 800, fill: '#94a3b8' }} dy={10} />
                <YAxis hide />
                <Tooltip 
                  content={({ active, payload }: any) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className={`p-4 rounded-2xl shadow-2xl border transition-colors duration-300 ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100'}`}>
                          <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-1">{payload[0].payload.fullDate}</p>
                          <p className="text-sm font-black text-sky-500">{payload[0].value} Permintaan</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Area type="monotone" dataKey="permintaan" stroke="#0ea5e9" strokeWidth={4} fillOpacity={1} fill="url(#colorUsage)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-slate-900 rounded-3xl md:rounded-[2.5rem] p-6 md:p-8 text-white shadow-2xl relative overflow-hidden">
            <h3 className="text-lg md:text-xl font-black mb-2 relative z-10">Aksi Cepat</h3>
            <p className="text-slate-400 text-[10px] md:text-xs font-medium mb-6 md:mb-8 relative z-10">Pintasan navigasi cepat berdasarkan hak akses Anda.</p>
            
            <div className="grid grid-cols-2 gap-3 md:gap-4 relative z-10">
              <Link to="/requests" className="p-4 bg-white/10 hover:bg-white/20 rounded-2xl transition-all group">
                <span className="material-symbols-outlined text-sky-400 mb-2 md:mb-3 group-hover:scale-110 transition-transform text-2xl md:text-3xl">lock_reset</span>
                <div className="text-[9px] md:text-[10px] font-black uppercase tracking-tighter">Proses Request</div>
              </Link>
              {isSuperAdmin && (
                <Link to="/personnel" className="p-4 bg-white/10 hover:bg-white/20 rounded-2xl transition-all group">
                  <span className="material-symbols-outlined text-emerald-400 mb-2 md:mb-3 group-hover:scale-110 transition-transform text-2xl md:text-3xl">manage_accounts</span>
                  <div className="text-[9px] md:text-[10px] font-black uppercase tracking-tighter">Kelola Personel</div>
                </Link>
              )}
              <Link to="/settings" className="p-4 bg-white/10 hover:bg-white/20 rounded-2xl transition-all group">
                <span className="material-symbols-outlined text-orange-400 mb-2 md:mb-3 group-hover:scale-110 transition-transform text-2xl md:text-3xl">tune</span>
                <div className="text-[9px] md:text-[10px] font-black uppercase tracking-tighter">Profil Akun</div>
              </Link>
              {isSuperAdmin && (
                <Link to="/logs" className="p-4 bg-white/10 hover:bg-white/20 rounded-2xl transition-all group">
                  <span className="material-symbols-outlined text-indigo-400 mb-2 md:mb-3 group-hover:scale-110 transition-transform text-2xl md:text-3xl">security</span>
                  <div className="text-[9px] md:text-[10px] font-black uppercase tracking-tighter">Audit Log</div>
                </Link>
              )}
            </div>
          </div>

          <div className={`rounded-3xl md:rounded-[2.5rem] p-6 md:p-8 shadow-sm border ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-50'}`}>
            <h3 className={`font-black text-base md:text-lg mb-6 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Permintaan Terbaru</h3>
            <div className="space-y-4">
              {recentRequests.map(req => (
                <div key={req.id} className="flex items-center gap-3 md:gap-4">
                  <div className={`w-8 h-8 md:w-10 md:h-10 rounded-lg md:rounded-xl flex items-center justify-center font-black text-[10px] md:text-xs ${isDarkMode ? 'bg-slate-800 text-slate-400' : 'bg-slate-50 text-slate-500'}`}>
                    {req.nama.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className={`text-[10px] md:text-xs font-black truncate ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{req.nama}</div>
                    <div className="text-[8px] md:text-[10px] text-slate-400 font-bold uppercase">{req.kesatuan}</div>
                  </div>
                  <div className={`text-[8px] md:text-[10px] font-black uppercase ${
                    req.status === RequestStatus.MENUNGGU ? 'text-amber-500' :
                    req.status === RequestStatus.DIPROSES ? 'text-blue-500' : 'text-emerald-500'
                  }`}>
                    {req.status === RequestStatus.MENUNGGU ? 'Baru' : req.status === RequestStatus.DIPROSES ? 'Proses' : 'Selesai'}
                  </div>
                </div>
              ))}
              {recentRequests.length === 0 && (
                <p className="text-[10px] text-slate-400 italic text-center py-4">Belum ada permintaan.</p>
              )}
              <Link to="/requests" className="block text-center text-[9px] md:text-[10px] font-black text-sky-600 uppercase tracking-widest pt-4 hover:underline">Lihat Semua</Link>
            </div>
          </div>
        </div>
      </div>
    </motion.main>
  );
};

export default Dashboard;
