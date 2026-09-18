
import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { motion, AnimatePresence } from 'motion/react';
import { SiteSettings, Notification, Personnel, UserRole } from '../types';

interface MobileTopbarProps {
  siteSettings: SiteSettings;
  setSiteSettings: React.Dispatch<React.SetStateAction<SiteSettings>>;
  notifications: Notification[];
  currentUser: Personnel;
  onLogout: () => void;
}

const MobileTopbar: React.FC<MobileTopbarProps> = ({ siteSettings, setSiteSettings, notifications, currentUser, onLogout }) => {
  const isDarkMode = siteSettings.darkMode;
  const [isOpen, setIsOpen] = useState(false);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const unreadCount = notifications.filter(n => !n.read).length;

  const isSuperAdmin = currentUser.role === UserRole.SUPERADMIN;
  const isAdmin = currentUser.role === UserRole.ADMIN;
  const isUser = currentUser.role === UserRole.USER;

  const toggleDarkMode = () => {
    setSiteSettings(prev => ({ ...prev, darkMode: !prev.darkMode }));
  };

  const navItems = [];

  if (isSuperAdmin) {
    navItems.push({ path: '/', icon: 'dashboard', label: 'Dashboard' });
    navItems.push({ path: '/settings', icon: 'settings', label: 'Pengaturan' });
    navItems.push({ path: '/requests', icon: 'lock_reset', label: 'Permintaan Reset' });
    navItems.push({ path: '/personnel', icon: 'group', label: 'Data Personel' });
    navItems.push({ path: '/reports', icon: 'analytics', label: 'Rekap Laporan' });
    navItems.push({ path: '/logs', icon: 'security_update_good', label: 'Log Sistem' });
  } else if (isAdmin) {
    navItems.push({ path: '/', icon: 'dashboard', label: 'Dashboard' });
    navItems.push({ path: '/settings', icon: 'settings', label: 'Pengaturan' });
    navItems.push({ path: '/requests', icon: 'lock_reset', label: 'Permintaan Reset' });
    navItems.push({ path: '/personnel', icon: 'group', label: 'Data Personel' });
    navItems.push({ path: '/reports', icon: 'analytics', label: 'Rekap Laporan' });
  } else if (isUser) {
    navItems.push({ path: '/requests', icon: 'lock_reset', label: 'Permintaan Reset' });
  }

  const handleLogoutClick = () => {
    setShowLogoutConfirm(true);
  };

  const confirmLogout = () => {
    setIsOpen(false);
    setShowLogoutConfirm(false);
    onLogout();
  };

  return (
    <>
      <nav className={`md:hidden fixed inset-x-0 top-0 z-50 border-b h-14 flex items-center justify-between px-4 print:hidden transition-colors duration-300 ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`}>
        <div className="flex items-center gap-3">
          <button 
            onClick={() => setIsOpen(true)}
            className={`p-2 rounded-lg border transition-colors duration-300 min-w-[44px] min-h-[44px] flex items-center justify-center ${isDarkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-white border-slate-200 text-slate-800'}`}
          >
            <span className="material-symbols-outlined text-2xl">menu</span>
          </button>

          <div className="flex items-center gap-2">
            {siteSettings.logo ? (
              <div className="w-8 h-8 flex items-center justify-center">
                <img src={siteSettings.logo} alt="Logo" className="w-7 h-7 object-contain drop-shadow-sm" />
              </div>
            ) : (
              <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-blue-600 shadow-sm ${isDarkMode ? 'bg-slate-800 border border-slate-700' : 'bg-white border border-slate-200'}`}>
                <span className="material-symbols-outlined text-lg">local_police</span>
              </div>
            )}
            <span className={`font-bold text-sm truncate max-w-[120px] ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>{siteSettings.name}</span>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {(isAdmin || isUser) && (
            <button 
              onClick={toggleDarkMode}
              className={`p-2 rounded-lg border transition-colors duration-300 min-w-[44px] min-h-[44px] flex items-center justify-center ${isDarkMode ? 'bg-slate-800 border-slate-700 text-sky-400' : 'bg-white border-slate-200 text-slate-600'}`}
            >
              <span className="material-symbols-outlined text-xl">{isDarkMode ? 'light_mode' : 'dark_mode'}</span>
            </button>
          )}

          <button className={`relative p-2 rounded-lg border transition-colors duration-300 min-w-[44px] min-h-[44px] flex items-center justify-center ${isDarkMode ? 'bg-slate-800 border-slate-700 text-slate-400' : 'bg-white border-slate-200 text-slate-600'}`}>
            <span className="material-symbols-outlined text-xl">notifications</span>
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 bg-rose-500 text-white text-[10px] px-1.5 py-0.5 rounded-full font-bold">
                {unreadCount}
              </span>
            )}
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] md:hidden print:hidden"
              onClick={() => setIsOpen(false)}
            />

            <motion.aside 
              initial={{ x: '-100%' }}
              animate={{ x: 0 }}
              exit={{ x: '-100%' }}
              transition={{ type: 'spring', damping: 25, stiffness: 200 }}
              className={`fixed inset-y-0 left-0 w-72 shadow-2xl z-[70] md:hidden flex flex-col print:hidden ${isDarkMode ? 'bg-slate-900' : 'bg-white'}`}
            >
              <div className={`p-4 border-b flex items-center justify-between ${isDarkMode ? 'border-slate-800' : 'border-slate-100'}`}>
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 flex items-center justify-center">
                    <img src={siteSettings.logo || ''} alt="Logo" className="w-8 h-8 object-contain" />
                  </div>
                  <div>
                    <div className={`text-sm font-bold truncate max-w-[150px] ${isDarkMode ? 'text-white' : 'text-slate-800'}`}>{siteSettings.name}</div>
                    <div className="text-[10px] text-sky-600 font-black uppercase tracking-widest">Bid Tik Polri</div>
                  </div>
                </div>
                <button 
                  onClick={() => setIsOpen(false)} 
                  className="p-2 text-slate-400 min-w-[44px] min-h-[44px] flex items-center justify-center"
                >
                  <span className="material-symbols-outlined">close</span>
                </button>
              </div>

              <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto scrollbar-hide">
                {navItems.map((item) => (
                  <NavLink
                    key={item.path}
                    to={item.path}
                    onClick={() => setIsOpen(false)}
                    className={({ isActive }: { isActive: boolean }) =>
                      `flex items-center gap-3 px-4 py-3.5 rounded-xl transition-all min-h-[48px] ${
                        isActive
                          ? 'bg-sky-600 text-white font-bold shadow-lg shadow-sky-900/20'
                          : `font-bold ${isDarkMode ? 'text-slate-400 hover:bg-slate-800' : 'text-slate-600 hover:bg-slate-50'}`
                      }`
                    }
                  >
                    <span className="material-symbols-outlined text-[24px]">{item.icon}</span>
                    <span className="text-sm">{item.label}</span>
                  </NavLink>
                ))}
              </nav>

              <div className={`p-6 border-t mt-auto pb-safe ${isDarkMode ? 'border-slate-800' : 'border-slate-100'}`}>
                <button 
                  onClick={handleLogoutClick}
                  className={`w-full flex items-center justify-center gap-3 py-4 rounded-2xl font-black text-xs uppercase tracking-widest transition-all min-h-[48px] ${
                    isDarkMode 
                      ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500 hover:text-white' 
                      : 'bg-rose-50 text-rose-600 border border-rose-100 hover:bg-rose-600 hover:text-white'
                  }`}
                > 
                  <span className="material-symbols-outlined text-xl">logout</span>
                  Logout
                </button>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Logout Confirmation Modal */}
      <AnimatePresence>
        {showLogoutConfirm && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
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
              className={`relative w-full max-w-sm p-6 rounded-3xl shadow-2xl ${isDarkMode ? 'bg-slate-900 border border-slate-800' : 'bg-white'}`}
            >
              <div className="flex flex-col items-center text-center">
                <div className="w-16 h-16 bg-rose-100 text-rose-600 rounded-full flex items-center justify-center mb-4">
                  <span className="material-symbols-outlined text-3xl">logout</span>
                </div>
                <h3 className={`text-lg font-black mb-2 ${isDarkMode ? 'text-white' : 'text-slate-900'}`}>Konfirmasi Logout</h3>
                <p className={`text-sm mb-8 ${isDarkMode ? 'text-slate-400' : 'text-slate-500'}`}>Apakah Anda yakin ingin keluar dari sistem?</p>
                
                <div className="grid grid-cols-2 gap-3 w-full">
                  <button 
                    onClick={() => setShowLogoutConfirm(false)}
                    className={`py-3.5 rounded-2xl font-black text-xs uppercase tracking-widest transition-all ${
                      isDarkMode ? 'bg-slate-800 text-slate-300 hover:bg-slate-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    Batal
                  </button>
                  <button 
                    onClick={confirmLogout}
                    className="py-3.5 rounded-2xl bg-rose-600 text-white font-black text-xs uppercase tracking-widest shadow-lg shadow-rose-900/20 hover:bg-rose-700 transition-all"
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

export default MobileTopbar;