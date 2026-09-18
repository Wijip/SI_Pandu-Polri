
import React, { useState, useRef } from 'react';
import { SiteSettings, Personnel, LogEntry, UserRole } from '../types';

interface SettingsProps {
  siteSettings: SiteSettings;
  setSiteSettings: React.Dispatch<React.SetStateAction<SiteSettings>>;
  currentUser: Personnel;
  setCurrentUser: React.Dispatch<React.SetStateAction<Personnel | null>>;
  showToast: (msg: string, type?: 'success' | 'error') => void;
  addLog?: (aktivitas: LogEntry['aktivitas'], keterangan: string) => void;
}

const Settings: React.FC<SettingsProps> = ({ 
  siteSettings,
  setSiteSettings,
  currentUser, 
  setCurrentUser, 
  showToast,
  addLog
}) => {
  const siteLogoRef = useRef<HTMLInputElement>(null);
  const adminPhotoRef = useRef<HTMLInputElement>(null);
  
  // Penentuan Role
  const isSuperAdmin = currentUser.role === UserRole.SUPERADMIN;
  const isAdminPolres = currentUser.role === UserRole.ADMIN;
  
  // Local state for Website Settings
  const [siteForm, setSiteForm] = useState({
    name: siteSettings.name,
    logo: siteSettings.logo,
    loginTitle: siteSettings.loginTitle || '',
    loginSubtitle: siteSettings.loginSubtitle || '',
    loginTagline1: siteSettings.loginTagline1 || '',
    loginTagline2: siteSettings.loginTagline2 || '',
    requestsTitle: siteSettings.requestsTitle || '',
    requestsSubtitle: siteSettings.requestsSubtitle || '',
    darkMode: siteSettings.darkMode || false
  });

  // Local state for Admin/Personnel Identity
  const [adminForm, setAdminForm] = useState({
    nama: currentUser.nama || '',
    pangkat: currentUser.pangkat || '',
    nrp: currentUser.nrp || '',
    jabatan: currentUser.jabatan || '',
    kesatuan: currentUser.kesatuan || '',
    email: currentUser.email || '',
    telepon: currentUser.telepon || '',
    foto: currentUser.foto || ''
  });

  const [passwordForm, setPasswordForm] = useState({
    current: '',
    new: '',
    confirm: ''
  });

  const getPasswordStrength = (pass: string) => {
    if (!pass) return 0;
    let score = 0;
    if (pass.length >= 8) score += 25;
    if (/[A-Z]/.test(pass)) score += 25;
    if (/[0-9]/.test(pass)) score += 25;
    if (/[!@#$%^&*(),.?":{}|<>]/.test(pass)) score += 25;
    return score;
  };

  const passwordStrength = getPasswordStrength(passwordForm.new);

  const checkPasswordStrength = (pass: string) => {
    const hasNumber = /\d/.test(pass);
    const hasSymbol = /[!@#$%^&*(),.?":{}|<>]/.test(pass);
    const hasUpper = /[A-Z]/.test(pass);
    return pass.length >= 8 && hasNumber && hasSymbol && hasUpper;
  };

  const handleUpdateSite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isSuperAdmin) return; // Proteksi tambahan
    
    const newSettings = {
      name: siteForm.name,
      logo: siteForm.logo,
      loginTitle: siteForm.loginTitle,
      loginSubtitle: siteForm.loginSubtitle,
      loginTagline1: siteForm.loginTagline1,
      loginTagline2: siteForm.loginTagline2,
      requestsTitle: siteForm.requestsTitle,
      requestsSubtitle: siteForm.requestsSubtitle,
      darkMode: siteForm.darkMode
    };

    try {
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings)
      });

      if (res.ok) {
        const data = await res.json();
        if (data.updatedLogo) {
          newSettings.logo = data.updatedLogo;
          setSiteForm(prev => ({ ...prev, logo: data.updatedLogo }));
        }
        setSiteSettings(newSettings);
        showToast('Identitas website berhasil diperbarui');
        addLog?.('Pengaturan', `Memperbarui identitas website: ${siteForm.name}`);
      } else {
        showToast('Gagal memperbarui identitas website', 'error');
      }
    } catch (error) {
      console.error('Error updating settings:', error);
      showToast('Terjadi kesalahan koneksi', 'error');
    }
  };

  const handleUpdateAdminProfile = (e: React.FormEvent) => {
    e.preventDefault();
    const updatedUser = { 
      ...currentUser, 
      ...adminForm 
    };
    setCurrentUser(updatedUser);
    showToast('Profil berhasil diperbarui');
    addLog?.('Sistem', `Memperbarui profil: ${adminForm.nama}`);
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const extension = file.name.split('.').pop()?.toLowerCase();
      const validExtensions = ['jpg', 'jpeg', 'png', 'svg', 'ico', 'bmp'];
      
      if (!extension || !validExtensions.includes(extension)) {
         showToast('Format tidak valid. Hanya JPG, JPEG, PNG, SVG, ICO, BMP.', 'error');
         if (siteLogoRef.current) siteLogoRef.current.value = '';
         return;
      }
      if (file.size > 2 * 1024 * 1024) {
        showToast('Ukuran file terlalu besar (Maks 2MB)', 'error');
        if (siteLogoRef.current) siteLogoRef.current.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setSiteForm(prev => ({ ...prev, logo: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAdminPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 2 * 1024 * 1024) {
        showToast('Ukuran file terlalu besar (Maks 2MB)', 'error');
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setAdminForm(prev => ({ ...prev, foto: reader.result as string }));
      };
      reader.readAsDataURL(file);
    }
  };

  const handlePasswordUpdate = (e: React.FormEvent) => {
    e.preventDefault();
    if (passwordForm.current !== currentUser.passwordPlain) {
      return showToast('Password saat ini tidak valid', 'error');
    }
    if (!checkPasswordStrength(passwordForm.new)) {
      return showToast('Password baru harus minimal 8 karakter, mengandung huruf besar, angka, dan simbol', 'error');
    }
    if (passwordForm.new !== passwordForm.confirm) {
      return showToast('Konfirmasi password tidak cocok', 'error');
    }
    setCurrentUser({ ...currentUser, passwordPlain: passwordForm.new });
    showToast('Password berhasil diperbarui');
    addLog?.('Sistem', 'Melakukan pembaruan password keamanan akun');
    setPasswordForm({ current: '', new: '', confirm: '' });
  };

  return (
    <main className={`p-6 md:p-10 space-y-8 max-w-[1000px] mx-auto animate-in fade-in duration-500 pb-20 transition-colors duration-300`}>
      
      {/* SECTION: Identitas Website (HANYA UNTUK SUPER ADMIN) */}
      {isSuperAdmin && (
        <div className={`rounded-[2.5rem] shadow-sm border overflow-hidden transition-colors duration-300 ${siteSettings.darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100'}`}>
          <div className={`p-8 flex items-center gap-4 transition-colors duration-300 ${siteSettings.darkMode ? 'bg-slate-800/50' : 'bg-slate-50/50'}`}>
            <div className="w-12 h-12 rounded-2xl bg-sky-50 text-sky-600 flex items-center justify-center">
              <span className="material-symbols-outlined text-3xl">language</span>
            </div>
            <div>
              <h3 className={`font-black text-lg ${siteSettings.darkMode ? 'text-white' : 'text-slate-800'}`}>Identitas Website & Login</h3>
              <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Branding & Penamaan Halaman Utama (Pusat)</p>
            </div>
          </div>

          <form onSubmit={handleUpdateSite} className="p-8 space-y-10">
            <div className="flex flex-col md:flex-row gap-10 items-start">
              <div className="flex flex-col items-center gap-4">
                <div className={`w-32 h-32 rounded-3xl border-2 border-dashed flex items-center justify-center overflow-hidden group relative shadow-inner transition-colors duration-300 ${siteSettings.darkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                  {siteForm.logo ? (
                    <img src={siteForm.logo} alt="Logo Preview" className="w-full h-full object-contain p-4" />
                  ) : (
                    <span className="material-symbols-outlined text-4xl text-slate-300">image</span>
                  )}
                  <button 
                    type="button"
                    onClick={() => siteLogoRef.current?.click()}
                    className="absolute inset-0 bg-slate-900/60 text-white flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <span className="material-symbols-outlined">upload</span>
                    <span className="text-[10px] font-black uppercase mt-1">Ganti Logo</span>
                  </button>
                </div>
                <input type="file" ref={siteLogoRef} className="hidden" accept=".jpg,.jpeg,.png,.svg,.ico,.bmp,image/jpeg,image/png,image/svg+xml,image/x-icon,image/bmp" onChange={handleLogoChange} />
                <p className="text-[10px] text-slate-400 font-bold text-center">Logo Website & Login<br/>(PNG/SVG/JPG/BMP/ICO)</p>
              </div>

              <div className="flex-1 space-y-6 w-full">
                <div className="grid grid-cols-1 gap-6">
                  <div className="space-y-2">
                    <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Nama Website / Satuan</label>
                    <input 
                      type="text" 
                      className={`w-full px-6 py-4 rounded-2xl border focus:outline-none focus:ring-4 focus:ring-sky-500/5 font-bold transition-all ${
                        siteSettings.darkMode ? 'bg-slate-800 border-slate-700 text-white focus:bg-slate-700' : 'bg-slate-50 border-slate-100 text-slate-700 focus:bg-white focus:border-sky-500'
                      }`}
                      value={siteForm.name}
                      onChange={(e) => setSiteForm(prev => ({ ...prev, name: e.target.value }))}
                      required
                      placeholder="Contoh: Polda Jawa Timur"
                    />
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Judul Halaman Login</label>
                      <input 
                        type="text" 
                        className={`w-full px-6 py-4 rounded-2xl border focus:outline-none font-bold transition-all text-sm ${
                          siteSettings.darkMode ? 'bg-slate-800 border-slate-700 text-white focus:bg-slate-700' : 'bg-slate-50 border-slate-100 text-slate-700 focus:bg-white focus:border-sky-500'
                        }`}
                        value={siteForm.loginTitle}
                        onChange={(e) => setSiteForm(prev => ({ ...prev, loginTitle: e.target.value }))}
                        placeholder="Contoh: Reset Password Email Polri"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Sub-judul Halaman Login</label>
                      <input 
                        type="text" 
                        className={`w-full px-6 py-4 rounded-2xl border focus:outline-none font-bold transition-all text-sm ${
                          siteSettings.darkMode ? 'bg-slate-800 border-slate-700 text-white focus:bg-slate-700' : 'bg-slate-50 border-slate-100 text-slate-700 focus:bg-white focus:border-sky-500'
                        }`}
                        value={siteForm.loginSubtitle}
                        onChange={(e) => setSiteForm(prev => ({ ...prev, loginSubtitle: e.target.value }))}
                        placeholder="Contoh: Bid Tik Polda Jatim"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Tagline Login Baris 1</label>
                      <input 
                        type="text" 
                        className={`w-full px-6 py-4 rounded-2xl border focus:outline-none font-bold transition-all text-sm ${
                          siteSettings.darkMode ? 'bg-slate-800 border-slate-700 text-white focus:bg-slate-700' : 'bg-slate-50 border-slate-100 text-slate-700 focus:bg-white focus:border-sky-500'
                        }`}
                        value={siteForm.loginTagline1}
                        onChange={(e) => setSiteForm(prev => ({ ...prev, loginTagline1: e.target.value }))}
                        placeholder="Contoh: MENGABDI DENGAN INTEGRITAS"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Tagline Login Baris 2</label>
                      <input 
                        type="text" 
                        className={`w-full px-6 py-4 rounded-2xl border focus:outline-none font-bold transition-all text-sm ${
                          siteSettings.darkMode ? 'bg-slate-800 border-slate-700 text-white focus:bg-slate-700' : 'bg-slate-50 border-slate-100 text-slate-700 focus:bg-white focus:border-sky-500'
                        }`}
                        value={siteForm.loginTagline2}
                        onChange={(e) => setSiteForm(prev => ({ ...prev, loginTagline2: e.target.value }))}
                        placeholder="Contoh: MELAYANI DENGAN TEKNOLOGI"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Judul Manajemen Reset</label>
                      <input 
                        type="text" 
                        className={`w-full px-6 py-4 rounded-2xl border focus:outline-none font-bold transition-all text-sm ${
                          siteSettings.darkMode ? 'bg-slate-800 border-slate-700 text-white focus:bg-slate-700' : 'bg-slate-50 border-slate-100 text-slate-700 focus:bg-white focus:border-sky-500'
                        }`}
                        value={siteForm.requestsTitle}
                        onChange={(e) => setSiteForm(prev => ({ ...prev, requestsTitle: e.target.value }))}
                        placeholder="Contoh: Manajemen Reset Password"
                      />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Sub-judul Manajemen Reset</label>
                      <input 
                        type="text" 
                        className={`w-full px-6 py-4 rounded-2xl border focus:outline-none font-bold transition-all text-sm ${
                          siteSettings.darkMode ? 'bg-slate-800 border-slate-700 text-white focus:bg-slate-700' : 'bg-slate-50 border-slate-100 text-slate-700 focus:bg-white focus:border-sky-500'
                        }`}
                        value={siteForm.requestsSubtitle}
                        onChange={(e) => setSiteForm(prev => ({ ...prev, requestsSubtitle: e.target.value }))}
                        placeholder="Contoh: Pantau dan eksekusi permohonan akses personel"
                      />
                    </div>
                  </div>

                  <div className="flex items-center justify-between p-6 rounded-3xl bg-slate-50/50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-700">
                    <div className="flex items-center gap-4">
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${siteSettings.darkMode ? 'bg-amber-500/10 text-amber-500' : 'bg-amber-50 text-amber-600'}`}>
                        <span className="material-symbols-outlined">dark_mode</span>
                      </div>
                      <div>
                        <div className={`text-sm font-black ${siteSettings.darkMode ? 'text-white' : 'text-slate-800'}`}>Mode Gelap (Dark Mode)</div>
                        <div className="text-[10px] text-slate-400 font-bold uppercase tracking-widest">Ubah tampilan antarmuka sistem</div>
                      </div>
                    </div>
                    <button 
                      type="button"
                      onClick={() => setSiteForm(prev => ({ ...prev, darkMode: !prev.darkMode }))}
                      className={`w-14 h-8 rounded-full relative transition-all duration-300 ${siteForm.darkMode ? 'bg-sky-600' : 'bg-slate-200'}`}
                    >
                      <div className={`absolute top-1 w-6 h-6 rounded-full bg-white shadow-sm transition-all duration-300 ${siteForm.darkMode ? 'left-7' : 'left-1'}`}></div>
                    </button>
                  </div>
                </div>

                <div className="flex justify-end pt-4">
                  <button type="submit" className="px-10 py-4 bg-sky-600 text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl shadow-sky-100 hover:bg-sky-700 transition-all active:scale-95">
                    Simpan Perubahan Website
                  </button>
                </div>
              </div>
            </div>
          </form>
        </div>
      )}

      {/* SECTION: Profil Pribadi */}
      <div className={`rounded-[2.5rem] shadow-sm border overflow-hidden transition-colors duration-300 ${siteSettings.darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100'}`}>
        <div className={`p-8 flex items-center gap-4 transition-colors duration-300 ${siteSettings.darkMode ? 'bg-slate-800/50' : 'bg-slate-50/50'}`}>
          <div className="w-12 h-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
            <span className="material-symbols-outlined text-3xl">badge</span>
          </div>
          <div>
            <h3 className={`font-black text-lg ${siteSettings.darkMode ? 'text-white' : 'text-slate-800'}`}>
              {isSuperAdmin ? 'Profil Super Admin' : isAdminPolres ? 'Profil Admin Polres' : 'Profil Personel'}
            </h3>
            <p className="text-xs text-slate-400 font-bold uppercase tracking-widest">Identitas Akun & Jabatan</p>
          </div>
        </div>

        <form onSubmit={handleUpdateAdminProfile} className="p-8 space-y-10">
          <div className="flex flex-col md:flex-row gap-10 items-start">
            <div className="flex flex-col items-center gap-4">
              <div className={`w-40 h-40 rounded-[2rem] border-4 shadow-xl flex items-center justify-center overflow-hidden group relative transition-colors duration-300 ${siteSettings.darkMode ? 'bg-slate-800 border-slate-700' : 'bg-slate-100 border-white'}`}>
                {adminForm.foto ? (
                  <img src={adminForm.foto} alt="Photo" className="w-full h-full object-cover" />
                ) : (
                  <div className="text-4xl font-black text-slate-300 uppercase">{adminForm.nama.charAt(0)}</div>
                )}
                <button 
                  type="button"
                  onClick={() => adminPhotoRef.current?.click()}
                  className="absolute inset-0 bg-indigo-900/60 text-white flex flex-col items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <span className="material-symbols-outlined">camera_alt</span>
                  <span className="text-[10px] font-black uppercase mt-1">Ganti Foto</span>
                </button>
              </div>
              <input type="file" ref={adminPhotoRef} className="hidden" accept="image/*" onChange={handleAdminPhotoChange} />
              <p className="text-[10px] text-slate-400 font-bold text-center">Format: JPG/PNG/WEBP<br/>Maks 2MB</p>
            </div>

            <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-6 w-full">
              <div className="space-y-2">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Nama Lengkap</label>
                <input 
                  type="text" 
                  className={`w-full px-5 py-3.5 rounded-xl border focus:outline-none font-bold transition-all text-sm ${
                    siteSettings.darkMode ? 'bg-slate-800 border-slate-700 text-white focus:border-indigo-500' : 'bg-slate-50 border-slate-100 text-slate-700 focus:bg-white focus:border-indigo-500'
                  }`}
                  value={adminForm.nama}
                  onChange={(e) => setAdminForm(prev => ({ ...prev, nama: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Pangkat</label>
                <input 
                  type="text" 
                  className={`w-full px-5 py-3.5 rounded-xl border focus:outline-none font-bold transition-all text-sm ${
                    siteSettings.darkMode ? 'bg-slate-800 border-slate-700 text-white focus:border-indigo-500' : 'bg-slate-50 border-slate-100 text-slate-700 focus:bg-white focus:border-indigo-500'
                  }`}
                  value={adminForm.pangkat}
                  onChange={(e) => setAdminForm(prev => ({ ...prev, pangkat: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">NRP / NIP</label>
                <input 
                  type="text" 
                  className={`w-full px-5 py-3.5 rounded-xl border focus:outline-none font-bold transition-all text-sm ${
                    siteSettings.darkMode ? 'bg-slate-800 border-slate-700 text-white focus:border-indigo-500' : 'bg-slate-50 border-slate-100 text-slate-700 focus:bg-white focus:border-indigo-500'
                  }`}
                  value={adminForm.nrp}
                  onChange={(e) => setAdminForm(prev => ({ ...prev, nrp: e.target.value }))}
                  required
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Jabatan</label>
                <input 
                  type="text" 
                  className={`w-full px-5 py-3.5 rounded-xl border focus:outline-none font-bold transition-all text-sm ${
                    siteSettings.darkMode ? 'bg-slate-800 border-slate-700 text-white focus:border-indigo-500' : 'bg-slate-50 border-slate-100 text-slate-700 focus:bg-white focus:border-indigo-500'
                  }`}
                  value={adminForm.jabatan}
                  onChange={(e) => setAdminForm(prev => ({ ...prev, jabatan: e.target.value }))}
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Kesatuan</label>
                <input 
                  type="text" 
                  className={`w-full px-5 py-3.5 rounded-xl border focus:outline-none font-bold transition-all text-sm opacity-60 ${
                    siteSettings.darkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-100 text-slate-700'
                  }`}
                  value={adminForm.kesatuan}
                  readOnly
                  disabled
                />
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Telepon (WA)</label>
                <input 
                  type="text" 
                  className={`w-full px-5 py-3.5 rounded-xl border focus:outline-none font-bold transition-all text-sm ${
                    siteSettings.darkMode ? 'bg-slate-800 border-slate-700 text-white focus:border-indigo-500' : 'bg-slate-50 border-slate-100 text-slate-700 focus:bg-white focus:border-indigo-500'
                  }`}
                  value={adminForm.telepon}
                  onChange={(e) => setAdminForm(prev => ({ ...prev, telepon: e.target.value }))}
                />
              </div>
            </div>
          </div>
          {!isAdminPolres && (
            <div className="flex justify-end pt-4 border-t border-slate-100 dark:border-slate-800">
              <button type="submit" className="px-8 py-4 bg-indigo-600 text-white rounded-2xl font-black text-sm uppercase tracking-widest shadow-xl shadow-indigo-100 hover:bg-indigo-700 transition-all active:scale-95">
                Perbarui Profil
              </button>
            </div>
          )}
        </form>
      </div>

      {/* SECTION: Keamanan & Password */}
      <div className={`rounded-[2.5rem] shadow-sm border overflow-hidden transition-colors duration-300 ${siteSettings.darkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-100'}`}>
        <div className={`p-8 flex items-center gap-4 transition-colors duration-300 ${siteSettings.darkMode ? 'bg-slate-800/50' : 'bg-slate-50/50'}`}>
          <div className="w-10 h-10 rounded-xl bg-orange-50 text-orange-600 flex items-center justify-center">
            <span className="material-symbols-outlined text-2xl">shield</span>
          </div>
          <h3 className={`font-black ${siteSettings.darkMode ? 'text-white' : 'text-slate-800'}`}>Keamanan & Password</h3>
        </div>
        
        <form onSubmit={handlePasswordUpdate} className="p-8 space-y-8">
          <div className="space-y-6 max-w-2xl">
            <div className="space-y-2">
              <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Password Saat Ini</label>
              <input 
                type="password" 
                className={`w-full px-6 py-4 rounded-2xl border focus:outline-none text-sm font-bold transition-all ${
                  siteSettings.darkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-100 text-slate-700'
                }`}
                placeholder="........"
                value={passwordForm.current}
                onChange={(e) => setPasswordForm({...passwordForm, current: e.target.value})}
              />
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Password Baru</label>
                <input 
                  type="password" 
                  className={`w-full px-6 py-4 rounded-2xl border focus:outline-none text-sm font-bold transition-all ${
                    siteSettings.darkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-100 text-slate-700'
                  }`}
                  placeholder="Min. 8 karakter + Simbol/Angka"
                  value={passwordForm.new}
                  onChange={(e) => setPasswordForm({...passwordForm, new: e.target.value})}
                />
                {passwordForm.new && (
                  <div className="mt-3 px-1">
                    <div className="flex justify-between items-center mb-1.5">
                      <span className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Kekuatan Password</span>
                      <span className={`text-[10px] font-black uppercase ${
                        passwordStrength <= 25 ? 'text-rose-500' :
                        passwordStrength <= 50 ? 'text-amber-500' :
                        passwordStrength <= 75 ? 'text-blue-500' : 'text-emerald-500'
                      }`}>
                        {passwordStrength <= 25 ? 'Sangat Lemah' :
                         passwordStrength <= 50 ? 'Lemah' :
                         passwordStrength <= 75 ? 'Kuat' : 'Sangat Kuat'}
                      </span>
                    </div>
                    <div className={`h-1.5 w-full rounded-full overflow-hidden ${siteSettings.darkMode ? 'bg-slate-800' : 'bg-slate-100'}`}>
                      <div 
                        className={`h-full transition-all duration-500 ${
                          passwordStrength <= 25 ? 'bg-rose-500' :
                          passwordStrength <= 50 ? 'bg-amber-500' :
                          passwordStrength <= 75 ? 'bg-blue-500' : 'bg-emerald-500'
                        }`}
                        style={{ width: `${passwordStrength}%` }}
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-x-4 gap-y-1 mt-3">
                      <div className={`flex items-center gap-1.5 text-[9px] font-bold uppercase ${passwordForm.new.length >= 8 ? 'text-emerald-500' : 'text-slate-400'}`}>
                        <span className="material-symbols-outlined text-xs">{passwordForm.new.length >= 8 ? 'check_circle' : 'circle'}</span>
                        Min. 8 Karakter
                      </div>
                      <div className={`flex items-center gap-1.5 text-[9px] font-bold uppercase ${/[A-Z]/.test(passwordForm.new) ? 'text-emerald-500' : 'text-slate-400'}`}>
                        <span className="material-symbols-outlined text-xs">{/[A-Z]/.test(passwordForm.new) ? 'check_circle' : 'circle'}</span>
                        Huruf Besar
                      </div>
                      <div className={`flex items-center gap-1.5 text-[9px] font-bold uppercase ${/\d/.test(passwordForm.new) ? 'text-emerald-500' : 'text-slate-400'}`}>
                        <span className="material-symbols-outlined text-xs">{/\d/.test(passwordForm.new) ? 'check_circle' : 'circle'}</span>
                        Angka
                      </div>
                      <div className={`flex items-center gap-1.5 text-[9px] font-bold uppercase ${/[!@#$%^&*(),.?":{}|<>]/.test(passwordForm.new) ? 'text-emerald-500' : 'text-slate-400'}`}>
                        <span className="material-symbols-outlined text-xs">{/[!@#$%^&*(),.?":{}|<>]/.test(passwordForm.new) ? 'check_circle' : 'circle'}</span>
                        Simbol
                      </div>
                    </div>
                  </div>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-xs font-black text-slate-400 uppercase tracking-widest pl-1">Konfirmasi Password</label>
                <input 
                  type="password" 
                  className={`w-full px-6 py-4 rounded-2xl border focus:outline-none text-sm font-bold transition-all ${
                    siteSettings.darkMode ? 'bg-slate-800 border-slate-700 text-white' : 'bg-slate-50 border-slate-100 text-slate-700'
                  }`}
                  placeholder="Ulangi password baru"
                  value={passwordForm.confirm}
                  onChange={(e) => setPasswordForm({...passwordForm, confirm: e.target.value})}
                />
              </div>
            </div>
            {!isAdminPolres && (
              <button 
                type="submit"
                className="px-8 py-4 bg-slate-900 text-white rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-slate-800 transition-all shadow-xl shadow-slate-200"
              >
                Perbarui Password
              </button>
            )}
          </div>
        </form>
      </div>
    </main>
  );
};

export default Settings;
