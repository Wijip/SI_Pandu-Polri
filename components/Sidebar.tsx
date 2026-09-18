
import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { SiteSettings, Personnel, UserRole } from '../types';

interface SidebarProps {
  siteSettings: SiteSettings;
  setSiteSettings: React.Dispatch<React.SetStateAction<SiteSettings>>;
  currentUser: Personnel;
  onLogout: () => void;
  hasUrgentRequest?: boolean;
  setHasUrgentRequest?: (val: boolean) => void;
}

const Sidebar: React.FC<SidebarProps> = ({ 
  siteSettings, 
  setSiteSettings, 
  currentUser, 
  onLogout,
  hasUrgentRequest = false,
  setHasUrgentRequest
}) => {
  const isSuperAdmin = currentUser.role === UserRole.SUPERADMIN;
  const isAdmin = currentUser.role === UserRole.ADMIN;
  const isUser = currentUser.role === UserRole.USER;
  const isAnyAdmin = isSuperAdmin || isAdmin;
  const isDarkMode = siteSettings.darkMode;
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);

  const toggleDarkMode = () => {
    setSiteSettings(prev => ({ ...prev, darkMode: !prev.darkMode }));
  };
  
  const mainNav = (isSuperAdmin || isAdmin) ? [
    { path: '/', icon: 'dashboard', label: 'Dashboard' },
    { path: '/settings', icon: 'tune', label: 'Pengaturan' },
  ] : isUser ? [
    { path: '/requests', icon: 'lock_reset', label: 'Permintaan Reset' },
  ] : [];

  const adminNav = [
    { path: '/requests', icon: 'lock_reset', label: 'Permintaan Reset' },
  ];

  // Admin & Super Admin mendapatkan menu administrasi lengkap
  if (isSuperAdmin || isAdmin) {
    adminNav.push(
      { path: '/personnel', icon: 'badge', label: 'Data Personel' },
      { path: '/reports', icon: 'analytics', label: 'Rekap Laporan' }
    );
    
    if (isSuperAdmin) {
      adminNav.push({ path: '/logs', icon: 'security_update_good', label: 'Log Sistem' });
    }
  }

  return (
    <>
      <aside className={`hidden md:flex flex-col w-72 border-r h-screen sticky top-0 shadow-[10px_0_30px_-15px_rgba(0,0,0,0.03)] print:hidden transition-colors duration-300 ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100'}`}>
        <div className="p-8 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <div className="w-14 h-14 flex items-center justify-center">
              {siteSettings.logo ? (
                <img src={siteSettings.logo} alt="Logo" className="w-12 h-12 object-contain drop-shadow-md" />
              ) : (
                <span className={`material-symbols-outlined text-3xl ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>local_police</span>
              )}
            </div>
            <div className="min-w-0">
              <div className={`text-lg font-black tracking-tighter leading-none ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>{siteSettings.name}</div>
              <div className="text-[10px] text-sky-600 font-black uppercase tracking-widest mt-1">Bid Tik Polri</div>
            </div>
          </div>
          
          {isAnyAdmin && hasUrgentRequest && (
            <div 
              onClick={() => setHasUrgentRequest?.(false)}
              className="relative cursor-pointer group"
            >
              <div className="absolute -inset-1 bg-rose-500 rounded-full blur opacity-25 group-hover:opacity-50 transition duration-1000 group-hover:duration-200 animate-pulse"></div>
              <div className="relative w-10 h-10 bg-rose-500 text-white rounded-full flex items-center justify-center shadow-lg animate-bounce">
                <span className="material-symbols-outlined text-xl">notifications_active</span>
              </div>
            </div>
          )}
        </div>

        <div className="flex-1 px-4 py-4 space-y-8 overflow-y-auto scrollbar-hide">
          <div>
            <div className="px-4 mb-3 text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">Utama</div>
            <nav className="space-y-1">
              {mainNav.map((item) => (
                <NavLink
                  key={item.path}
                  to={item.path}
                  className={({ isActive }: { isActive: boolean }) =>
                    `flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all duration-300 ${
                      isActive
                        ? 'bg-sky-600 text-white shadow-xl shadow-sky-900/20 font-bold'
                        : `font-bold ${isDarkMode ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-500 hover:bg-slate-50'}`
                    }`
                  }
                >
                  <span className="material-symbols-outlined text-[26px]">{item.icon}</span>
                  <span className="text-sm">{item.label}</span>
                </NavLink>
              ))}
            </nav>
          </div>

          {isAnyAdmin && (
            <div>
              <div className="px-4 mb-3 text-[10px] font-black text-slate-300 uppercase tracking-[0.2em]">Administrasi</div>
              <nav className="space-y-1">
                {adminNav.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    className={({ isActive }: { isActive: boolean }) =>
                      `flex items-center gap-4 px-4 py-3.5 rounded-2xl transition-all duration-300 ${
                        isActive
                          ? 'bg-sky-600 text-white shadow-xl shadow-sky-900/20 font-bold'
                          : `font-bold ${isDarkMode ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-500 hover:bg-slate-50'}`
                      }`
                    }
                  >
                    <span className="material-symbols-outlined text-[26px]">{item.icon}</span>
                    <span className="text-sm">{item.label}</span>
                  </NavLink>
                ))}
              </nav>
            </div>
          )}
        </div>

        <div className="p-6 mt-auto space-y-4">
          {(isAdmin || isUser) && (
            <button
              onClick={toggleDarkMode}
              className={`w-full p-4 rounded-2xl border flex items-center justify-between transition-all duration-300 ${
                isDarkMode 
                  ? 'bg-slate-800 border-slate-700 text-sky-400' 
                  : 'bg-slate-50 border-slate-100 text-slate-600'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-xl">
                  {isDarkMode ? 'light_mode' : 'dark_mode'}
                </span>
                <span className="text-xs font-black uppercase tracking-widest">
                  {isDarkMode ? 'Mode Terang' : 'Mode Gelap'}
                </span>
              </div>
              <div className={`w-10 h-5 rounded-full relative transition-colors ${isDarkMode ? 'bg-sky-500' : 'bg-slate-300'}`}>
                <div className={`absolute top-1 w-3 h-3 rounded-full bg-white transition-all ${isDarkMode ? 'left-6' : 'left-1'}`} />
              </div>
            </button>
          )}

          <div className={`p-4 rounded-[2rem] border flex items-center gap-3 transition-colors duration-300 ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-100'}`}>
            <div className="w-10 h-10 rounded-xl bg-sky-600 text-white flex items-center justify-center font-black text-sm shadow-md overflow-hidden">
              {currentUser.foto ? (
                <img src={currentUser.foto} alt="Profile" className="w-full h-full object-cover" />
              ) : (
                currentUser.nama.charAt(0)
              )}
            </div>
            <div className="min-w-0">
              <div className={`text-xs font-black truncate ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>
                {isSuperAdmin ? 'Polda Jatim' : currentUser.kesatuan || 'Polda Jatim'}
              </div>
              <div className="text-[9px] font-black text-slate-400 uppercase tracking-widest">
                {isSuperAdmin ? 'SUPER ADMIN' : isAdmin ? 'ADMIN' : 'USER'}
              </div>
            </div>
          </div>
          <button
            onClick={() => setShowLogoutConfirm(true)}
            className={`w-full py-4 rounded-2xl transition-all flex items-center justify-center gap-3 font-black text-xs uppercase tracking-widest ${isDarkMode ? 'bg-rose-500/10 text-rose-400 hover:bg-rose-500 hover:text-white' : 'bg-rose-50 text-rose-600 hover:bg-rose-600 hover:text-white'}`}
          >
            <span className="material-symbols-outlined text-xl">logout</span>
            Keluar
          </button>
        </div>
      </aside>

      <AnimatePresence>
        {showLogoutConfirm && (
          <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm"
              onClick={() => setShowLogoutConfirm(false)}
            />
            <motion.div 
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              className={`relative w-full max-w-sm p-8 rounded-3xl shadow-2xl ${isDarkMode ? 'bg-slate-900 border border-slate-800' : 'bg-white'}`}
            >
              <div className="flex flex-col items-center text-center">
                <div className="w-20 h-20 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mb-6">
                  <span className="material-symbols-outlined text-4xl">logout</span>
                </div>
                <h3 className={`text-xl font-black mb-3 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Konfirmasi Logout</h3>
                <p className={`text-sm mb-8 leading-relaxed ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Apakah Anda yakin ingin keluar dari sistem manajemen reset password?</p>
                
                <div className="grid grid-cols-2 gap-4 w-full">
                  <button 
                    onClick={() => setShowLogoutConfirm(false)}
                    className={`py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all ${
                      isDarkMode ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    Batal
                  </button>
                  <button 
                    onClick={() => { setShowLogoutConfirm(false); onLogout(); }}
                    className="py-4 rounded-2xl bg-rose-600 text-white font-black text-xs uppercase tracking-widest shadow-lg shadow-rose-900/20 hover:bg-rose-700 transition-all"
                  >
                    Ya, Keluar
                  </button>
                </div>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </>
  );
};

export default Sidebar;
